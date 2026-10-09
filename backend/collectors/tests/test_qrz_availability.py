import asyncio
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import collectors.main as main
import httpx
from shared.cty import CtyCountry
from shared.qrz import QrzSessionManager


class CollectorQrzAvailabilityTest(IsolatedAsyncioTestCase):
    async def test_sequential_spots_are_persisted_with_cty_during_refresh_outage(self):
        manager = QrzSessionManager("fake", "fake", "fake", 3600)
        manager.session_key = "expired"
        await manager.http_client.aclose()
        manager.http_client = AsyncMock()
        manager.http_client.get.return_value = httpx.Response(
            200, text='<QRZDatabase xmlns="http://xmldata.qrz.com"><Error>Session expired</Error></QRZDatabase>'
        )
        queue = asyncio.Queue()
        for i in range(3):
            queue.put_nowait(
                {
                    "dx_callsign": f"K{i}ABC",
                    "spotter_callsign": "W1ABC",
                    "frequency": 14074.0,
                    "mode": "FT8",
                    "comment": "",
                }
            )
        country = CtyCountry("United States", "NA", 291, 40, -100, 5, 8)
        engine = AsyncMock()
        with (
            patch.object(main, "get_valkey_client", return_value=None),
            patch.object(main, "create_async_engine", return_value=engine),
            patch.object(main, "persist_spot", AsyncMock()) as persist,
            patch.object(main, "is_active_dxpedition", return_value=False),
            patch("shared.geo._resolve_cty_entity", return_value=country),
            patch("shared.qrz.get_qrz_session_key", AsyncMock(side_effect=httpx.ConnectTimeout("fake outage"))),
        ):
            task = asyncio.create_task(main.process_spots(queue, manager))
            try:
                async with asyncio.timeout(1):
                    await queue.join()
            finally:
                task.cancel()
                await task
            self.assertEqual(persist.await_count, 3)
            for call in persist.await_args_list:
                spot = call.args[2]
                self.assertEqual((spot["dx_locator_source"], spot["spotter_locator_source"]), ("cty", "cty"))
            engine.dispose.assert_awaited_once()
        await manager.aclose()

    async def test_starts_sources_and_processor_before_auth_and_closes_resources(self):
        started = set()
        ready = asyncio.Event()
        manager = QrzSessionManager("fake", "fake", "fake", 3600)
        auth_started = asyncio.Event()

        async def unavailable_auth(*args, **kwargs):
            auth_started.set()
            await asyncio.Future()

        async def worker(name, *args):
            started.add(name)
            if {"processor", "pota", "wwff", "telnet"}.issubset(started):
                ready.set()
            await asyncio.Future()

        def telnet(queue):
            return [asyncio.create_task(worker("telnet", queue))]

        with (
            patch.object(main, "ensure_cty_available", AsyncMock()),
            patch.object(main, "get_valkey_client", return_value=None),
            patch.object(main, "close_valkey_client", AsyncMock()) as close,
            patch.object(main, "QrzSessionManager", return_value=manager),
            patch("shared.qrz.get_qrz_session_key", side_effect=unavailable_auth),
            patch.object(main, "refresh_dxpedition_data", new=lambda *a: worker("aux-dx", *a)),
            patch.object(main, "refresh_lotw_user_data", new=lambda *a: worker("aux-lotw", *a)),
            patch.object(main, "process_spots", new=lambda *a: worker("processor", *a)),
            patch.object(main, "run_pota_collector", new=lambda *a: worker("pota", *a)),
            patch.object(main, "run_wwff_collector", new=lambda *a: worker("wwff", *a)),
            patch.object(main, "run_concurrent_telnet_connections", side_effect=telnet),
            patch.object(main, "SOTA_ENABLED", False),
        ):
            task = asyncio.create_task(main.run_collector())
            try:
                async with asyncio.timeout(1):
                    await auth_started.wait()
                    await ready.wait()
                self.assertEqual(manager.get_key(), "")
            finally:
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
            close.assert_awaited_once()
        self.assertTrue(manager.http_client.is_closed)
