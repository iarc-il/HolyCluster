import asyncio
import os
from datetime import datetime, timezone
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import httpx
from sqlalchemy.dialects import postgresql

os.environ.setdefault("SENTRY_ENVIRONMENT", "dev")
os.environ.setdefault("SENTRY_RELEASE", "test")

import collectors.main  # noqa: E402
from collectors.enrichers.lotw import serialize_lotw_user_activity  # noqa: E402
from collectors.main import add_spot_to_postgres  # noqa: E402


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
