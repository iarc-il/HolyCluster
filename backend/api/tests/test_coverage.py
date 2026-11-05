import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from prometheus_client import REGISTRY

from api import main
from api.coverage import COVERAGE_MAXLEN, CoveragePublisher


def count(outcome):
    return REGISTRY.get_sample_value("holycluster_api_coverage_publications_total", {"outcome": outcome}) or 0


def raw_spot():
    return {
        "time": "0811Z",
        "timestamp": "1730621460.0",
        "spotter_callsign": "DM5TO",
        "spotter_lon": "1",
        "spotter_lat": "2",
        "spotter_dxcc_code": "1",
        "spotter_continent": "EU",
        "dx_callsign": "DK5MER/P",
        "dx_lon": "3",
        "dx_lat": "4",
        "dx_dxcc_code": "2",
        "dx_continent": "EU",
        "frequency": "14328.0",
        "band": "20",
        "mode": "SSB",
        "comment": "original comment",
    }


class CoverageTest(unittest.IsolatedAsyncioTestCase):
    async def run_batch(self, failure=None, hang=False):
        stream = MagicMock()
        stream.xgroup_create = AsyncMock()
        stream.xack = AsyncMock()
        stream.xdel = AsyncMock()
        stream.aclose = AsyncMock()
        coverage = MagicMock()
        coverage.aclose = AsyncMock()
        pipeline = MagicMock()
        pipeline.__aenter__ = AsyncMock(return_value=pipeline)
        pipeline.__aexit__ = AsyncMock(return_value=False)
        coverage.pipeline.return_value = pipeline
        entered = asyncio.Event()
        acknowledged = asyncio.Event()

        async def execute():
            entered.set()
            if hang:
                await asyncio.Event().wait()
            if failure:
                raise failure
            return ["1-0", "2-0"]

        pipeline.execute = AsyncMock(side_effect=execute)
        raw = raw_spot()
        specialized = {**raw, "cluster": "pota.app", "type": "pota"}
        reads = 0

        async def read(*args, **kwargs):
            nonlocal reads
            reads += 1
            if reads == 1:
                return [("stream-api", [("1-0", raw), ("2-0", dict(raw)), ("3-0", {}), ("4-0", specialized)])]
            acknowledged.set()
            await entered.wait()
            # Let the publisher finish, but do not wait for it when it hangs.
            await asyncio.sleep(0)
            raise asyncio.CancelledError

        stream.xreadgroup = AsyncMock(side_effect=read)
        broadcast = AsyncMock()
        with (
            patch("api.main.redis.asyncio.Redis", side_effect=[stream, coverage]) as factory,
            patch.object(main, "broadcast_spots", broadcast),
        ):
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(main.spots_broadcast_task(SimpleNamespace()), 1)
        self.assertTrue(acknowledged.is_set())
        stream.xack.assert_awaited_once_with("stream-api", "api-group", "1-0", "2-0", "3-0", "4-0")
        stream.xdel.assert_awaited_once_with("stream-api", "1-0", "2-0", "3-0", "4-0")
        stream.aclose.assert_awaited_once()
        coverage.aclose.assert_awaited_once()
        broadcast.assert_awaited_once()
        spots = broadcast.await_args.args[1]
        self.assertEqual(len(spots), 3)
        self.assertEqual(spots[0]["time"], float(raw["timestamp"]))
        self.assertNotIn("frequency", spots[0])
        self.assertEqual(pipeline.xadd.call_count, 2)
        for call in pipeline.xadd.call_args_list:
            self.assertEqual(call.args[0], "coverage-holy")
            record = call.args[1]
            self.assertEqual(
                set(record),
                {"time", "dx_callsign", "frequency", "spotter_callsign", "comment", "observed_at", "spot_key"},
            )
            for field in ("time", "dx_callsign", "frequency", "spotter_callsign", "comment"):
                self.assertEqual(record[field], raw[field])
            self.assertGreater(record["observed_at"], 0)
            self.assertEqual(record["spot_key"], "0811Z:DK5MER/P:14328.0:DM5TO")
            self.assertEqual(call.kwargs, {"maxlen": COVERAGE_MAXLEN, "approximate": False})
        coverage.pipeline.assert_called_once_with(transaction=False)
        pipeline.execute.assert_awaited_once()
        retry = factory.call_args.kwargs["retry"]
        self.assertEqual(retry.get_retries(), 0)
        self.assertTrue(asyncio.iscoroutinefunction(retry.call_with_retry))

    async def test_raw_identity_is_published_after_broadcast(self):
        before = count("success")
        await self.run_batch()
        self.assertEqual(count("success"), before + 2)

    async def test_specialized_spots_are_excluded(self):
        publisher = CoveragePublisher()
        before = count("excluded")
        for spot_type in ("pota", "sota", "wwff"):
            publisher.submit({**raw_spot(), "type": spot_type})
        self.assertTrue(publisher.queue.empty())
        self.assertEqual(count("excluded"), before + 3)

    async def test_publication_failure_does_not_retry_or_block_ack_delete(self):
        before = count("error")
        await self.run_batch(failure=ConnectionError("offline"))
        self.assertEqual(count("error"), before + 2)

    async def test_hung_publication_does_not_delay_ack_delete(self):
        await self.run_batch(hang=True)

    async def test_failed_broadcast_does_not_publish(self):
        client = MagicMock()
        client.xgroup_create = AsyncMock()
        client.xreadgroup = AsyncMock(return_value=[("stream-api", [("1-0", raw_spot())])])
        client.xack = AsyncMock()
        client.xdel = AsyncMock()
        client.aclose = AsyncMock()
        before = count("success") + count("error")
        with (
            patch("api.main.redis.asyncio.Redis", return_value=client) as factory,
            patch.object(main, "broadcast_spots", AsyncMock(side_effect=RuntimeError("broadcast failed"))),
            patch("api.main.asyncio.sleep", AsyncMock(side_effect=asyncio.CancelledError)),
        ):
            with self.assertRaises(asyncio.CancelledError):
                await main.spots_broadcast_task(SimpleNamespace())
        factory.assert_called_once()
        client.xack.assert_not_awaited()
        client.xdel.assert_not_awaited()
        self.assertEqual(count("success") + count("error"), before)

    async def test_publication_timeout_drops_batch_without_retry(self):
        publisher = CoveragePublisher()
        publisher.submit(raw_spot())
        client = MagicMock()
        client.aclose = AsyncMock()
        pipeline = MagicMock()
        pipeline.__aenter__ = AsyncMock(return_value=pipeline)
        pipeline.__aexit__ = AsyncMock(return_value=False)
        client.pipeline.return_value = pipeline
        cancelled = asyncio.Event()

        async def execute():
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        pipeline.execute = AsyncMock(side_effect=execute)
        before = count("error")
        with (
            patch("api.coverage.redis.asyncio.Redis", return_value=client),
            patch("api.coverage.COVERAGE_TIMEOUT", 0.01),
        ):
            task = asyncio.create_task(publisher.run())
            try:
                await asyncio.wait_for(cancelled.wait(), 1)
                await asyncio.sleep(0)
                self.assertEqual(count("error"), before + 1)
                self.assertTrue(publisher.queue.empty())
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        pipeline.execute.assert_awaited_once()
        client.aclose.assert_awaited_once()

    async def test_queue_and_metric_cardinality_are_bounded(self):
        publisher = CoveragePublisher()
        before = count("error")
        for _ in range(publisher.queue.maxsize + 1):
            publisher.submit(raw_spot())
        self.assertEqual(publisher.queue.qsize(), publisher.queue.maxsize)
        self.assertEqual(count("error"), before + 1)
        publisher.submit({})
        self.assertEqual(count("error"), before + 2)
        families = [family for family in REGISTRY.collect() if family.name == "holycluster_api_coverage_publications"]
        self.assertEqual(len(families), 1)
        for sample in families[0].samples:
            self.assertEqual(set(sample.labels), {"outcome"})
            self.assertIn(sample.labels["outcome"], {"success", "error", "excluded"})
