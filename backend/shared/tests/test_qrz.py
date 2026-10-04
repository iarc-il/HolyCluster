from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import httpx

from shared.qrz import QRZ_REQUEST_ATTEMPTS, get_locator_from_qrz


class GetLocatorFromQrzTest(IsolatedAsyncioTestCase):
    async def test_returns_lookup_error_after_transport_retries(self):
        client = AsyncMock()
        client.get.side_effect = httpx.ConnectTimeout("unavailable")

        with patch("shared.qrz.asyncio.sleep", new=AsyncMock()):
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
        self.assertEqual(client.get.await_count, QRZ_REQUEST_ATTEMPTS)
