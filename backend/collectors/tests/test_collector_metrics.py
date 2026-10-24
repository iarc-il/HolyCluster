import asyncio
from io import StringIO
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import collectors.telnet.client as telnet
import redis.exceptions
from aiohttp import web
from collectors import main, utils
from collectors.metrics import CollectorMetrics, SpotEnvelope, start_metrics_server
from collectors.telnet import runner as telnet_runner
from collectors.pota import get_pota_spot_key, parse_pota_spot
from prometheus_client import generate_latest
from sqlalchemy.exc import SQLAlchemyError

PREFIX = "holycluster_collector_"


class MetricsTest(IsolatedAsyncioTestCase):
    def setUp(self):
        self.metrics = CollectorMetrics()

    def value(self, name, **labels):
        return self.metrics.registry.get_sample_value(PREFIX + name, labels)

    async def poll(self, responses, valkey=None, queue=None):
        valkey = valkey or AsyncMock()
        queue = queue if queue is not None else asyncio.Queue()
        calls = 0

        async def pause(*args):
            nonlocal calls
            calls += 1
            if calls == len(responses):
                raise asyncio.CancelledError

        with (
            patch.object(utils, "metrics", self.metrics, create=True),
            patch.object(utils, "fetch_json_list", AsyncMock(side_effect=responses)),
            patch("collectors.db.valkey_config.get_valkey_client", return_value=valkey),
            patch.object(utils.asyncio, "sleep", side_effect=pause),
        ):
            await utils.run_json_spot_collector(
                queue,
                source_label="POTA",
                metric_name="pota",
                url="https://private-host.invalid/secret",
                poll_interval=1,
                request_timeout=1,
                spot_expiration=60,
                get_spot_key=get_pota_spot_key,
                parse_spot=parse_pota_spot,
                sort_key=lambda spot: 0,
            )
        return queue

    async def test_empty_json_is_success_and_failure_preserves_last_success(self):
        await self.poll([[]])
        timestamp = self.value("poll_last_success_timestamp_seconds", source="pota")
        self.assertGreater(timestamp, 0)
        self.assertIsNone(self.value("source_last_spot_timestamp_seconds", source="pota"))
        self.assertEqual(self.value("source_up", source="pota"), 1)
        with self.assertRaises(asyncio.CancelledError):
            await self.poll([utils.UpstreamResponseError("private-content")])
        self.assertEqual(self.value("source_up", source="pota"), 0)
        self.assertEqual(self.value("poll_last_success_timestamp_seconds", source="pota"), timestamp)
        self.assertEqual(self.value("polls_total", source="pota", result="success"), 1)
        self.assertEqual(self.value("polls_total", source="pota", result="error"), 1)

    async def test_json_branches_and_envelope_reach_processor_with_one_completion_after_retries(self):
        raw = {
            "spotId": 1,
            "spotTime": "2026-10-24T10:00:00Z",
            "frequency": "14074",
            "spotter": "W1PRIVATE",
            "activator": "K1SECRET",
        }
        valkey = AsyncMock()
        valkey.set.side_effect = [True, True, False, True, False]
        queue = await self.poll([[None, {}, raw, raw, raw]], valkey)
        self.assertEqual(queue.qsize(), 1)
        self.assertGreater(self.value("source_last_spot_timestamp_seconds", source="pota"), 0)
        self.assertEqual(self.value("spots_total", source="pota", stage="ingest", result="malformed"), 2)
        self.assertEqual(self.value("spots_total", source="pota", stage="ingest", result="duplicate"), 2)
        self.assertEqual(self.value("spots_total", source="pota", stage="ingest", result="queued"), 1)
        envelope = queue.get_nowait()
        queue.task_done()
        self.assertIsInstance(envelope, SpotEnvelope)
        self.assertEqual(envelope.source, "pota")
        envelope.spot.update(cluster="not-a-source", spotter_locator="FN42", dx_locator="EM74", band="20m", mode="FT8")
        await queue.put(envelope)
        self.metrics.bind_queue(queue)
        self.assertEqual(self.value("queue_depth"), 1)
        stream = AsyncMock()
        stream.xadd.side_effect = [redis.exceptions.ConnectionError("private-content"), None]
        engine = AsyncMock()
        with (
            patch.object(main, "metrics", self.metrics, create=True),
            patch.object(main, "get_valkey_client", return_value=stream),
            patch.object(main, "create_async_engine", return_value=engine),
            patch.object(main, "enrich_spot", AsyncMock(return_value=envelope.spot)),
            patch.object(main, "add_spot_to_postgres", AsyncMock(side_effect=[SQLAlchemyError(), None, None])),
            patch.object(main.asyncio, "sleep", AsyncMock()),
        ):
            task = asyncio.create_task(main.process_spots(queue, MagicMock()))
            await asyncio.wait_for(queue.join(), 1)
            task.cancel()
            await task
        self.assertEqual(self.value("queue_depth"), 0)
        self.assertEqual(self.value("spots_total", source="pota", stage="pipeline", result="success"), 1)
        self.assertEqual(self.value("persistence_operations_total", operation="postgres_insert", result="attempt"), 3)
        self.assertEqual(self.value("persistence_operations_total", operation="valkey_xadd", result="attempt"), 2)
        self.assertEqual(self.value("persistence_operations_total", operation="postgres_insert", result="error"), 1)
        self.assertEqual(self.value("persistence_operations_total", operation="valkey_xadd", result="success"), 1)
        exposition = generate_latest(self.metrics.registry).decode()
        for private in ("PRIVATE", "SECRET", "private-host", "private-content", "not-a-source", "14074", "FN42"):
            self.assertNotIn(private, exposition)

    async def test_blocked_queue_does_not_count_queued_before_put(self):
        queue = asyncio.Queue(maxsize=1)
        await queue.put(SpotEnvelope("DXUSA", {}))
        put_started = asyncio.Event()
        original_put = queue.put

        async def put(item):
            put_started.set()
            await original_put(item)

        raw = {
            "spotId": 1,
            "spotTime": "2026-10-24T10:00:00Z",
            "frequency": "14074",
            "spotter": "W1A",
            "activator": "K1A",
        }
        with patch.object(queue, "put", side_effect=put):
            task = asyncio.create_task(self.poll([[raw]], queue=queue))
            await asyncio.wait_for(put_started.wait(), 1)
            self.assertIsNone(self.value("spots_total", source="pota", stage="ingest", result="queued"))
            task.cancel()
            await task

    async def test_telnet_health_is_independent_and_clean_eof_starts_aggregate_outage(self):
        self.metrics.start_telnet()
        incoming = [asyncio.Queue(), asyncio.Queue()]
        reading = [asyncio.Event(), asyncio.Event()]
        backoff = [asyncio.Event(), asyncio.Event()]
        writers = [MagicMock(), MagicMock()]
        readers = [MagicMock(), MagicMock()]
        for i in range(2):
            writers[i].wait_closed = AsyncMock()

            async def read(*args, i=i):
                reading[i].set()
                return await incoming[i].get()

            readers[i].read = read

        async def connect(host, port):
            i = int(port) - 1
            return readers[i], writers[i]

        async def pause(*args):
            i = 0 if asyncio.current_task().get_name() == "first" else 1
            backoff[i].set()
            await asyncio.Future()

        with (
            patch.object(telnet, "metrics", self.metrics, create=True),
            patch.object(telnet, "open_task_log_file", return_value=MagicMock()),
            patch.object(telnet, "get_valkey_client", return_value=AsyncMock()),
            patch.object(telnet.asyncio, "open_connection", side_effect=connect),
            patch.object(telnet.asyncio, "sleep", side_effect=pause),
        ):
            tasks = [
                asyncio.create_task(
                    telnet.telnet_and_collect(
                        "private-host", i + 1, "", "/tmp", asyncio.Queue(), source=("DXUSA", "K7AR")[i]
                    ),
                    name=name,
                )
                for i, name in enumerate(("first", "second"))
            ]
            try:
                await asyncio.wait_for(asyncio.gather(*(event.wait() for event in reading)), 1)
                self.assertEqual(self.value("source_up", source="DXUSA"), 1)
                self.assertEqual(self.value("source_up", source="K7AR"), 1)
                self.assertIsNone(self.value("source_up", source="telnet"))
                self.assertEqual(self.value("telnet_outage_duration_seconds"), 0)
                await incoming[0].put(b"")
                await asyncio.wait_for(backoff[0].wait(), 1)
                self.assertEqual(self.value("source_up", source="DXUSA"), 0)
                self.assertEqual(self.value("source_up", source="K7AR"), 1)
                await incoming[1].put(b"")
                await asyncio.wait_for(backoff[1].wait(), 1)
                self.assertEqual(self.value("source_up", source="DXUSA"), 0)
                self.assertEqual(self.value("source_up", source="K7AR"), 0)
                self.assertGreater(self.value("telnet_outage_duration_seconds"), 0)
                self.assertEqual(self.value("telnet_reconnect_attempts_total", source="DXUSA"), 0)
                self.assertEqual(self.value("telnet_reconnect_attempts_total", source="K7AR"), 0)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks)
        self.assertNotIn("private-host", generate_latest(self.metrics.registry).decode())

    async def test_http_listener_stops_with_collector_cancellation(self):
        started = asyncio.Event()
        server = None
        runner = None

        async def start(port):
            nonlocal server, runner
            runner = await start_metrics_server(0, self.metrics)
            server = next(iter(runner.sites))._server
            started.set()
            return runner

        async def worker(*args):
            await asyncio.Future()

        manager = MagicMock()
        manager.refresh_loop = worker
        manager.aclose = AsyncMock()
        with (
            patch.object(main, "metrics", self.metrics, create=True),
            patch.object(main, "start_metrics_server", side_effect=start, create=True) as listener,
            patch.object(main, "ensure_cty_available", AsyncMock()),
            patch.object(main, "get_valkey_client", return_value=None),
            patch.object(main, "close_valkey_client", AsyncMock()),
            patch.object(main, "QrzSessionManager", return_value=manager),
            patch.object(main, "refresh_dxpedition_data", worker),
            patch.object(main, "refresh_lotw_user_data", worker),
            patch.object(main, "process_spots", worker),
            patch.object(main, "run_concurrent_telnet_connections", return_value=[]),
            patch.object(main, "run_pota_collector", worker),
            patch.object(main, "run_wwff_collector", worker),
        ):
            task = asyncio.create_task(main.run_collector())
            try:
                await asyncio.wait_for(started.wait(), 1)
                port = server.sockets[0].getsockname()[1]
                async with (
                    aiohttp.ClientSession() as session,
                    session.get(f"http://127.0.0.1:{port}/metrics") as response,
                ):
                    self.assertEqual(response.status, 200)
                    self.assertIn(PREFIX + "source_up", await response.text())
                listener.assert_awaited_once_with(9101)
            finally:
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
        self.assertFalse(server.is_serving())
        self.assertFalse(runner.sites)

    async def test_fetch_decodes_empty_list_and_rejects_wrong_shape_over_http(self):
        payload = []

        async def respond(request):
            return web.json_response(payload)

        app = web.Application()
        app.router.add_get("/spots", respond)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        try:
            async with aiohttp.ClientSession() as session:
                url = f"http://127.0.0.1:{port}/spots"
                self.assertEqual(await utils.fetch_json_list(session, url, "POTA"), [])
                payload = {"error": "private-content"}
                with self.assertRaises(utils.UpstreamResponseError):
                    await utils.fetch_json_list(session, url, "POTA")
        finally:
            await runner.cleanup()

    async def test_telnet_parsed_activity_precedes_deduplication_and_reaches_persistence(self):
        queue = asyncio.Queue()
        incoming = asyncio.Queue()
        reading = asyncio.Event()
        reader, writer = MagicMock(), MagicMock()
        writer.wait_closed = AsyncMock()
        valkey = AsyncMock()
        valkey.set.side_effect = [True, False]

        async def read(*args):
            reading.set()
            return await incoming.get()

        reader.read = read
        line = b"DX de W1PRIVATE:    14074.0  K1SECRET    CQ 2010Z\n"
        with (
            patch.object(telnet, "metrics", self.metrics),
            patch.object(telnet, "open_task_log_file", return_value=MagicMock()),
            patch.object(telnet, "get_valkey_client", return_value=valkey),
            patch.object(telnet.asyncio, "open_connection", AsyncMock(return_value=(reader, writer))),
            patch("collectors.metrics.time.time", return_value=100),
        ):
            task = asyncio.create_task(
                telnet.telnet_and_collect("private-host", 7300, "", "/tmp", queue, source="DXUSA")
            )
            try:
                await asyncio.wait_for(reading.wait(), 1)
                reading.clear()
                await incoming.put(b"DX de malformed\n")
                await asyncio.wait_for(reading.wait(), 1)
                self.assertIsNone(self.value("source_last_spot_timestamp_seconds", source="DXUSA"))
                reading.clear()
                await incoming.put(line)
                await asyncio.wait_for(reading.wait(), 1)
                self.assertEqual(self.value("source_last_spot_timestamp_seconds", source="DXUSA"), 100)
                with patch("collectors.metrics.time.time", return_value=200):
                    reading.clear()
                    await incoming.put(line)
                    await asyncio.wait_for(reading.wait(), 1)
                self.assertEqual(self.value("source_last_spot_timestamp_seconds", source="DXUSA"), 200)
                reading.clear()
                await incoming.put(b"DX de malformed\n")
                await asyncio.wait_for(reading.wait(), 1)
                self.assertEqual(self.value("source_last_spot_timestamp_seconds", source="DXUSA"), 200)
            finally:
                task.cancel()
                await task
        self.assertEqual(queue.qsize(), 1)
        envelope = queue.get_nowait()
        queue.task_done()
        self.assertEqual(envelope.source, "DXUSA")
        self.assertEqual(self.value("spots_total", source="DXUSA", stage="ingest", result="duplicate"), 1)
        self.assertEqual(self.value("spots_total", source="DXUSA", stage="ingest", result="queued"), 1)
        envelope.spot.update(spotter_locator="FN42", dx_locator="EM74")
        await queue.put(envelope)
        engine = AsyncMock()
        with (
            patch.object(main, "metrics", self.metrics),
            patch.object(main, "get_valkey_client", return_value=valkey),
            patch.object(main, "create_async_engine", return_value=engine),
            patch.object(main, "enrich_spot", AsyncMock(return_value=envelope.spot)),
            patch.object(main, "persist_spot", AsyncMock()) as persist,
        ):
            task = asyncio.create_task(main.process_spots(queue, MagicMock()))
            await asyncio.wait_for(queue.join(), 1)
            task.cancel()
            await task
        persist.assert_awaited_once_with(engine, valkey, envelope.spot)
        self.assertEqual(self.value("spots_total", source="DXUSA", stage="pipeline", result="success"), 1)
        self.assertEqual(self.value("processing_duration_seconds_count", source="DXUSA", stage="persist"), 1)
        exposition = generate_latest(self.metrics.registry).decode()
        for private in ("private-host", "7300", "W1PRIVATE", "K1SECRET", 'source="telnet"'):
            self.assertNotIn(private, exposition)

    async def test_configured_sources_are_registered_before_connections_start(self):
        servers = [
            {"name": name, "hostname": "private-host", "port": "7300"} for name in ("DXUSA", "K7AR", "AI9T", "NC7J")
        ]
        with (
            patch.object(telnet_runner, "metrics", self.metrics),
            patch.object(telnet_runner, "get_telnet_clusters_list", return_value=servers),
            patch.object(telnet_runner.os, "makedirs"),
            patch.object(telnet_runner, "prune_rotated_logs"),
            patch.object(telnet_runner, "open_log_file"),
            patch.object(telnet_runner, "telnet_and_collect", AsyncMock()) as collect,
            patch.object(telnet_runner.settings, "username_for_telnet_clusters", "W1PRIVATE"),
        ):
            tasks = telnet_runner.run_concurrent_telnet_connections(asyncio.Queue())
            for server in servers:
                self.assertEqual(self.value("source_up", source=server["name"]), 0)
            await asyncio.gather(*tasks)
        self.assertEqual([call.kwargs["source"] for call in collect.call_args_list], [s["name"] for s in servers])
        self.assertIsNone(self.value("source_up", source="telnet"))

    async def test_source_names_reject_unbounded_values_and_duplicates(self):
        for name in ("", "telnet", "host.example", "host:7300", "A" * 33, "DΧUSA", "DXUSA\n", "1ABC"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                SpotEnvelope(name, {})
        for names in (("private-host.invalid",), ("DXUSA", "DXUSA")):
            csv = "name,hostname,port\n" + "".join(f"{name},private-host,7300\n" for name in names)
            with patch("builtins.open", return_value=StringIO(csv)), self.assertRaises(ValueError):
                telnet_runner.get_telnet_clusters_list("unused.csv")

    async def test_json_duplicate_updates_activity_but_malformed_and_empty_polls_do_not(self):
        raw = {
            "spotId": 1,
            "spotTime": "2026-10-24T10:00:00Z",
            "frequency": "14074",
            "spotter": "W1A",
            "activator": "K1A",
        }
        valkey = AsyncMock()
        valkey.set.return_value = False
        with patch("collectors.metrics.time.time", return_value=100):
            await self.poll([[raw]], valkey)
        self.assertEqual(self.value("source_last_spot_timestamp_seconds", source="pota"), 100)
        with patch("collectors.metrics.time.time", return_value=200):
            await self.poll([[raw]], valkey)
        self.assertEqual(self.value("source_last_spot_timestamp_seconds", source="pota"), 200)
        with patch("collectors.metrics.time.time", return_value=300):
            await self.poll([[None, {}], []], valkey)
        self.assertEqual(self.value("source_last_spot_timestamp_seconds", source="pota"), 200)

    async def test_reconnect_counter_excludes_initial_attempt(self):
        retry_started = asyncio.Event()
        attempts = {1: 0, 2: 0}

        async def connect(host, port):
            attempts[port] += 1
            if attempts[port] <= port:
                raise ConnectionRefusedError()
            if all(attempts[p] > p for p in attempts):
                retry_started.set()
            await asyncio.Future()

        with (
            patch.object(telnet, "metrics", self.metrics, create=True),
            patch.object(telnet, "open_task_log_file", return_value=MagicMock()),
            patch.object(telnet, "get_valkey_client", return_value=AsyncMock()),
            patch.object(telnet.asyncio, "open_connection", side_effect=connect),
            patch.object(telnet.asyncio, "sleep", AsyncMock()),
        ):
            tasks = [
                asyncio.create_task(
                    telnet.telnet_and_collect("private-host", port, "", "/tmp", asyncio.Queue(), source=source)
                )
                for port, source in ((1, "DXUSA"), (2, "K7AR"))
            ]
            try:
                await asyncio.wait_for(retry_started.wait(), 1)
                self.assertEqual(self.value("telnet_reconnect_attempts_total", source="DXUSA"), 1)
                self.assertEqual(self.value("telnet_reconnect_attempts_total", source="K7AR"), 2)
                self.assertEqual(self.value("source_up", source="DXUSA"), 0)
                self.assertEqual(self.value("source_up", source="K7AR"), 0)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks)

    async def test_refresh_loops_keep_last_success_on_failure(self):
        for dataset, loop, fetch in (
            ("lotw", main.refresh_lotw_user_data, "collectors.main.fetch_lotw_user_activity"),
            ("dxpeditions", main.refresh_dxpedition_data, "collectors.enrichers.dxpeditions.refresh_dxpedition_cache"),
        ):
            with self.subTest(dataset=dataset):
                timestamps = []

                async def pause(*args, timestamps=timestamps, dataset=dataset):
                    timestamps.append(self.value("refresh_last_success_timestamp_seconds", dataset=dataset))
                    if len(timestamps) == 2:
                        raise asyncio.CancelledError

                valkey = AsyncMock()
                valkey.get.return_value = None
                with (
                    patch.object(main, "metrics", self.metrics, create=True),
                    patch(fetch, AsyncMock(side_effect=[{}, ValueError("private-content")])),
                    patch.object(main.asyncio, "sleep", side_effect=pause),
                    patch.object(main, "capture_exception"),
                    patch.object(main, "LOTW_USERS", {}),
                    self.assertRaises(asyncio.CancelledError),
                ):
                    await loop(valkey)
                self.assertGreater(timestamps[0], 0)
                self.assertEqual(timestamps[0], timestamps[1])
                self.assertEqual(self.value("refresh_total", dataset=dataset, result="attempt"), 2)
                self.assertEqual(self.value("refresh_total", dataset=dataset, result="success"), 1)
                self.assertEqual(self.value("refresh_total", dataset=dataset, result="error"), 1)
