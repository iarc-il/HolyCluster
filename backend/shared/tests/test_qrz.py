import asyncio
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import httpx

from shared.cty import CtyCountry
from shared.geo import get_geo_details
from shared.qrz import QrzSessionManager, get_locator_from_qrz


def xml_response(body):
    return httpx.Response(200, text=f'<QRZDatabase xmlns="http://xmldata.qrz.com">{body}</QRZDatabase>')


class GetLocatorFromQrzTest(IsolatedAsyncioTestCase):
    async def test_transport_failure_is_not_retried_in_foreground(self):
        client = AsyncMock()
        client.get.side_effect = httpx.ConnectTimeout("fake DNS unavailable")
        result = await get_locator_from_qrz("session", "K1ABC", client)
        self.assertEqual(
            result,
            {
                "locator": None,
                "state": None,
                "cq_zone": None,
                "itu_zone": None,
                "error": "qrz request unavailable: ConnectTimeout",
            },
        )
        self.assertEqual(client.get.await_count, 1)

    async def test_expired_refresh_outage_uses_cty(self):
        client = AsyncMock()
        client.get.return_value = xml_response("<Session><Error>Session expired</Error></Session>")
        refresh = AsyncMock(side_effect=httpx.ConnectTimeout("fake outage"))
        country = CtyCountry("United States", "NA", 291, 40, -100, 5, 8)
        with patch("shared.geo._resolve_cty_entity", return_value=country):
            result = await get_geo_details(None, "old", "K1ABC", 3600, client, "dx", refresh)
        self.assertEqual(result.locator_source, "cty")
        self.assertEqual((result.dxcc_code, result.cq_zone, result.itu_zone), (291, 5, 8))

    async def test_total_deadline_covers_refresh_and_sequential_lookups(self):
        client = AsyncMock()
        client.get.return_value = xml_response("<Session><Error>Session expired</Error></Session>")
        cancelled = []

        async def blocked_refresh(key):
            try:
                await asyncio.Future()
            finally:
                cancelled.append(key)

        # Shorten the production two-second deadline, without making live requests.
        with patch("shared.qrz.QRZ_LOOKUP_BUDGET_SECONDS", 0.01):
            async with asyncio.timeout(0.5):
                for _ in range(3):
                    result = await get_locator_from_qrz("old", "K1ABC", client, blocked_refresh)
                    self.assertIn("TimeoutError", result["error"])
        self.assertEqual(cancelled, ["old"] * 3)

    async def test_cancellation_propagates(self):
        client = AsyncMock()
        client.get.side_effect = asyncio.CancelledError
        with self.assertRaises(asyncio.CancelledError):
            await get_locator_from_qrz("session", "K1ABC", client)

    async def test_refresh_is_deduplicated_and_successful_enrichment_survives(self):
        manager = QrzSessionManager("fake", "fake", "fake", 3600)
        manager.session_key = "old"
        client = AsyncMock()
        client.get.side_effect = [
            xml_response("<Session><Error>Session expired</Error></Session>"),
            xml_response(
                "<Callsign><geoloc>user</geoloc><grid>FN42</grid><state>MA</state>"
                "<cqzone>5</cqzone><ituzone>8</ituzone></Callsign>"
            ),
        ]
        try:
            with patch("shared.qrz.get_qrz_session_key", AsyncMock(return_value="new")) as auth:
                result = await get_locator_from_qrz("old", "K1ABC/P", client, manager.refresh_if_stale)
                keys = await asyncio.gather(*(manager.refresh_if_stale("old") for _ in range(3)))
            self.assertEqual(keys, ["new"] * 3)
            auth.assert_awaited_once()
            self.assertEqual(result, {"locator": "FN42", "state": "MA", "cq_zone": 5, "itu_zone": 8})
        finally:
            await manager.aclose()
        self.assertTrue(manager.http_client.is_closed)

    async def test_background_backoff_is_capped_and_auth_has_a_deadline(self):
        manager = QrzSessionManager("fake", "fake", "fake", 3600)
        try:
            with (
                patch.object(manager, "start", AsyncMock(side_effect=RuntimeError("outage"))),
                patch(
                    "shared.qrz.asyncio.sleep", AsyncMock(side_effect=[None] * 6 + [asyncio.CancelledError])
                ) as sleeps,
            ):
                with self.assertRaises(asyncio.CancelledError):
                    await manager.refresh_loop()
            self.assertEqual([call.args[0] for call in sleeps.await_args_list], [5, 10, 20, 40, 60, 60, 60])

            async def blocked_auth(**kwargs):
                await asyncio.Future()

            with (
                patch("shared.qrz.get_qrz_session_key", side_effect=blocked_auth),
                patch("shared.qrz.QRZ_AUTH_BUDGET_SECONDS", 0.01),
            ):
                with self.assertRaises(TimeoutError):
                    await manager.start()
            self.assertFalse(manager._lock.locked())
        finally:
            await manager.aclose()

    async def test_background_startup_outage_recovers_with_bounded_backoff(self):
        manager = QrzSessionManager("fake", "fake", "fake", 3600)
        auth = AsyncMock(side_effect=[RuntimeError("outage"), "recovered"])

        # The fake clock advances past the shared failure cooldown on retry.
        async def sleep(delay):
            manager._retry_after = 0
            if delay == 3600:
                raise asyncio.CancelledError

        try:
            with (
                patch("shared.qrz.get_qrz_session_key", auth),
                patch("shared.qrz.asyncio.sleep", AsyncMock(side_effect=sleep)) as sleeps,
            ):
                with self.assertRaises(asyncio.CancelledError):
                    await manager.refresh_loop()
            self.assertEqual(manager.get_key(), "recovered")
            self.assertEqual(sleeps.await_args_list[0].args, (5,))
        finally:
            await manager.aclose()
