import asyncio
import os
import socket
from datetime import datetime, timezone
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import httpx
from sqlalchemy.dialects import postgresql

os.environ.setdefault("SENTRY_ENVIRONMENT", "dev")
os.environ.setdefault("SENTRY_RELEASE", "test")

import collectors.main  # noqa: E402
from collectors.enrichers.lotw import serialize_lotw_user_activity  # noqa: E402
from collectors.main import add_spot_to_postgres, persist_spot  # noqa: E402
from collectors.metrics import SpotEnvelope  # noqa: E402


class RefreshLotwUserDataTest(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        collectors.main.LOTW_USERS = {}

    async def test_loads_cached_users_before_retrying_an_unavailable_endpoint(self):
        users = {"K1ABC": datetime(2026, 7, 31, 20, 15, 52, tzinfo=timezone.utc)}
        valkey_client = AsyncMock()
        valkey_client.get.return_value = serialize_lotw_user_activity(users)
        error = httpx.ConnectTimeout("unavailable")

        with (
            patch("collectors.main.fetch_lotw_user_activity", AsyncMock(side_effect=error)),
            patch("collectors.main.capture_exception") as capture,
            patch("collectors.main.asyncio.sleep", AsyncMock(side_effect=[None, asyncio.CancelledError])),
        ):
            with self.assertRaises(asyncio.CancelledError):
                await collectors.main.refresh_lotw_user_data(valkey_client)

        assert collectors.main.LOTW_USERS == users
        capture.assert_called_once_with(error, operation="collector.lotw_refresh")

    async def test_caches_a_successful_refresh(self):
        users = {"K1ABC": datetime(2026, 7, 31, 20, 15, 52, tzinfo=timezone.utc)}
        valkey_client = AsyncMock()
        valkey_client.get.return_value = None

        with (
            patch("collectors.main.fetch_lotw_user_activity", AsyncMock(return_value=users)),
            patch("collectors.main.asyncio.sleep", AsyncMock(side_effect=asyncio.CancelledError)),
        ):
            with self.assertRaises(asyncio.CancelledError):
                await collectors.main.refresh_lotw_user_data(valkey_client)

        assert collectors.main.LOTW_USERS == users
        valkey_client.set.assert_awaited_once_with(
            collectors.main.LOTW_CACHE_KEY,
            serialize_lotw_user_activity(users),
        )


class PersistSpotTest(IsolatedAsyncioTestCase):
    async def test_retries_raw_database_driver_failures(self):
        for error in (
            ConnectionRefusedError("database unavailable"),
            socket.gaierror(-3, "name resolution failed"),
            asyncpg.CannotConnectNowError("database shutting down"),
            asyncpg.InternalClientError("connection busy"),
        ):
            with self.subTest(error=type(error).__name__):
                engine = AsyncMock()
                valkey_client = AsyncMock()
                with (
                    patch("collectors.main.add_spot_to_postgres", AsyncMock(side_effect=[error, None])) as add,
                    patch("collectors.main.asyncio.sleep", new_callable=AsyncMock) as sleep,
                ):
                    await persist_spot(engine, valkey_client, {})
                self.assertEqual(add.await_count, 2)
                engine.dispose.assert_awaited_once_with()
                sleep.assert_awaited_once_with(1)

    async def test_processor_reports_terminal_database_failure_and_continues(self):
        queue = asyncio.Queue()
        for call in ("K1ABC", "K2ABC"):
            queue.put_nowait(SpotEnvelope("DXUSA", {"dx_callsign": call}))
        engine = AsyncMock()
        valkey_client = AsyncMock()
        enriched = {
            "dx_callsign": "K1ABC",
            "frequency": 14074,
            "spotter_locator": "FN31",
            "dx_locator": "EM00",
        }
        error = ConnectionRefusedError("database unavailable")
        manager = MagicMock()
        manager.get_key.return_value = "key"

        with (
            patch("collectors.main.get_valkey_client", return_value=valkey_client),
            patch("collectors.main.create_async_engine", return_value=engine) as create_engine,
            patch("collectors.main.enrich_spot", AsyncMock(return_value=enriched)),
            patch("collectors.main.persist_spot", AsyncMock(side_effect=[error, None])) as persist,
            patch("collectors.main.publish_coverage_pipeline_result", AsyncMock(return_value="success")),
            patch("collectors.main.capture_exception") as capture,
        ):
            task = asyncio.create_task(collectors.main.process_spots(queue, manager))
            try:
                async with asyncio.timeout(1):
                    await queue.join()
            finally:
                task.cancel()
                await task

        self.assertEqual(persist.await_count, 2)
        capture.assert_called_once_with(error, operation="collector.persist")
        create_engine.assert_called_once_with(
            collectors.main.settings.db_url,
            pool_pre_ping=True,
            pool_recycle=3600,
            hide_parameters=True,
        )
        engine.dispose.assert_awaited_once_with()

    async def test_processor_does_not_hide_programming_failures(self):
        queue = asyncio.Queue()
        queue.put_nowait(SpotEnvelope("DXUSA", {"dx_callsign": "K1ABC"}))
        engine = AsyncMock()
        enriched = {
            "dx_callsign": "K1ABC",
            "frequency": 14074,
            "spotter_locator": "FN31",
            "dx_locator": "EM00",
        }
        error = RuntimeError("broken persistence code")
        manager = MagicMock()
        manager.get_key.return_value = "key"

        with (
            patch("collectors.main.get_valkey_client", return_value=AsyncMock()),
            patch("collectors.main.create_async_engine", return_value=engine),
            patch("collectors.main.enrich_spot", AsyncMock(return_value=enriched)),
            patch("collectors.main.persist_spot", AsyncMock(side_effect=error)),
            patch("collectors.main.capture_exception") as capture,
        ):
            task = asyncio.create_task(collectors.main.process_spots(queue, manager))
            with self.assertRaisesRegex(RuntimeError, "broken persistence code"):
                await task

        capture.assert_not_called()
        await asyncio.wait_for(queue.join(), timeout=1)
        engine.dispose.assert_awaited_once_with()


class AddSpotToPostgresTest(IsolatedAsyncioTestCase):
    async def test_ignores_duplicate_spots(self):
        spot = {
            "cluster": "test",
            "timestamp": datetime(2026, 9, 18, 21, 0, tzinfo=timezone.utc).timestamp(),
            "frequency": "14074.0",
            "band": "20m",
            "mode": "FT8",
            "mode_selection": "source",
            "spotter_callsign": "W1BDL",
            "spotter_locator": "FN42",
            "spotter_locator_source": "test",
            "spotter_lat": "42.0",
            "spotter_lon": "-71.0",
            "spotter_dxcc_code": 291,
            "spotter_continent": "NA",
            "spotter_state": "MA",
            "spotter_cq_zone": 5,
            "spotter_itu_zone": 8,
            "dx_callsign": "K4ELI",
            "dx_locator": "EM74",
            "dx_locator_source": "test",
            "dx_lat": "34.0",
            "dx_lon": "-84.0",
            "dx_dxcc_code": 291,
            "dx_continent": "NA",
            "dx_state": "GA",
            "dx_cq_zone": 5,
            "dx_itu_zone": 8,
            "dx_lotw_status": "frequent",
            "comment": "",
            "is_dxpedition": 0,
        }
        session = AsyncMock()
        session.__aenter__.return_value = session

        with patch("collectors.main.AsyncSession", return_value=session):
            await add_spot_to_postgres(object(), spot)

        statement = session.execute.await_args.args[0]
        sql = str(statement.compile(dialect=postgresql.dialect()))
        assert "ON CONFLICT ON CONSTRAINT uc_holy_spots2 DO NOTHING" in sql
        session.commit.assert_awaited_once()
