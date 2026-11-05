import unittest
from datetime import UTC, datetime
from unittest.mock import patch

import httpx

from coverage_comparator.feeds.dxwatch import DXWatchAdapter


def spot(timestamp="2233z 03 Nov", *, spotter=" g0abc-12 ", frequency="14074.5", dx=" k1xyz "):
    return [spotter, frequency, dx, " CQ test ", timestamp]


class DXWatchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.now = datetime(2026, 11, 3, 22, 35, tzinfo=UTC).timestamp()
        self.responses = []
        self.requests = []

        def handle(request):
            self.requests.append(request)
            response = self.responses.pop(0)
            return response if isinstance(response, httpx.Response) else httpx.Response(200, json=response)

        self.session = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        self.adapter = DXWatchAdapter(session=self.session, base_url="https://example.test/", clock=lambda: self.now)

    async def asyncTearDown(self):
        await self.adapter.close()
        await self.session.aclose()

    async def seed(self, spot_id="10", timestamp="2233z 03 Nov"):
        self.responses.append({"s": {spot_id: spot(timestamp)}})
        result = await self.adapter.poll()
        self.assertEqual(result.spots, [])
        self.assertFalse(result.recoverable)

    async def test_seed_cursor_normalization_overlap_and_order(self):
        await self.seed()
        self.assertEqual(str(self.requests[0].url), "https://example.test/dxsd1/s.php?s=0&r=100")
        self.responses.append(
            {
                "s": {
                    "13": spot("2235z 03 Nov"),
                    "10": spot(),
                    "12": spot("2234z 03 Nov"),
                    "11": spot("2233z 03 Nov", spotter="g0abc-X"),
                }
            }
        )
        result = await self.adapter.poll()
        self.assertTrue(result.recoverable)
        self.assertEqual(str(self.requests[1].url), "https://example.test/dxsd1/s.php?s=10&r=100")
        self.assertIn("Firefox/", self.requests[1].headers["user-agent"])
        self.assertEqual(self.requests[1].extensions["timeout"]["read"], 15.0)
        self.assertEqual([s["time"] for s in result.spots], ["2233Z", "2234Z", "2235Z"])
        self.assertEqual(result.spots[0]["spotter_callsign"], "G0ABC-X")
        self.assertEqual(
            result.spots[1],
            {
                "time": "2234Z",
                "dx_callsign": "K1XYZ",
                "spotter_callsign": "G0ABC",
                "frequency": 14074.5,
                "comment": "CQ test",
                "observed_at": self.now - 60,
            },
        )
        self.responses.extend([{"s": {"12": spot(), "13": spot()}}, {"s": {}}])
        self.assertEqual((await self.adapter.poll()).spots, [])
        self.assertTrue((await self.adapter.poll()).recoverable)
        self.assertEqual(self.adapter._last_id, 13)

    async def test_year_rollover_both_directions(self):
        for now, timestamp, expected in (
            (datetime(2027, 1, 1, 0, 2, tzinfo=UTC), "2359z 31 Dec", datetime(2026, 12, 31, 23, 59, tzinfo=UTC)),
            (datetime(2026, 12, 31, 23, 59, tzinfo=UTC), "0001z 01 Jan", datetime(2027, 1, 1, 0, 1, tzinfo=UTC)),
        ):
            with self.subTest(timestamp=timestamp):
                self.now = now.timestamp()
                self.adapter._last_id = None
                await self.seed(timestamp=timestamp)
                self.responses.append({"s": {"11": spot(timestamp)}})
                result = await self.adapter.poll()
                self.assertEqual(result.spots[0]["observed_at"], expected.timestamp())

    async def test_rejects_old_future_and_invalid_dates_without_advancing(self):
        await self.seed()
        for timestamp in ("2233z 01 Nov", "2241z 03 Nov", "2233z 31 Feb", "2500z 03 Nov", "bad"):
            with self.subTest(timestamp=timestamp):
                self.responses.append({"s": {"11": spot(timestamp)}})
                self.assertFalse((await self.adapter.poll()).recoverable)
                self.assertEqual(self.adapter._last_id, 10)

    async def test_malformed_responses(self):
        await self.seed()
        for data in (
            [],
            {},
            {"s": []},
            {"s": {"bad": spot()}},
            {"s": {"11": ["short"]}},
            {"s": {"11": "not an array"}},
            {"s": {"11": spot(frequency="nan")}},
            {"s": {"11": spot(frequency=True)}},
            {"s": {"11": spot(dx=" ")}},
            {"s": {"11": [None, 14000, "DX", "comment", "2233z 03 Nov"]}},
        ):
            with self.subTest(data=data):
                self.responses.append(data)
                result = await self.adapter.poll()
                self.assertFalse(result.recoverable)
                self.assertEqual(result.spots, [])
                self.assertEqual(self.adapter._last_id, 10)

    async def test_challenge_and_non_json_do_not_advance_or_retry(self):
        await self.seed()
        for status, body in ((403, "Cloudflare"), (200, "<html>Just a moment...</html>"), (200, "not json")):
            self.responses.append(httpx.Response(status, text=body))
            self.assertFalse((await self.adapter.poll()).recoverable)
            self.assertEqual(self.adapter._last_id, 10)
        self.assertEqual(len(self.requests), 4)

    async def test_saturation_and_regression_mark_gap_and_rebaseline(self):
        self.adapter.rows = 2
        await self.seed()
        self.responses.append({"s": {"11": spot(), "12": spot()}})
        result = await self.adapter.poll()
        self.assertTrue(result.saturated)
        self.assertFalse(result.recoverable)
        self.assertEqual(result.spots, [])
        self.responses.append({"s": {"1": spot()}})
        result = await self.adapter.poll()
        self.assertFalse(result.recoverable)
        self.assertEqual(self.adapter._last_id, 12)
        self.responses.append({"s": {"13": spot()}})
        self.assertEqual(len((await self.adapter.poll()).spots), 1)
        self.assertEqual(self.requests[-1].url.params["s"], "12")

    async def test_oversized_response_and_long_outage(self):
        self.adapter.rows = 2
        await self.seed()
        self.responses.append({"s": {str(i): spot() for i in range(11, 14)}})
        result = await self.adapter.poll()
        self.assertTrue(result.saturated)
        self.assertFalse(result.recoverable)
        self.assertEqual(self.adapter._last_id, 10)
        self.now += 86401
        self.responses.append({"s": {"20": spot("2235z 04 Nov")}})
        result = await self.adapter.poll()
        self.assertFalse(result.recoverable)
        self.assertEqual(result.spots, [])
        self.assertEqual(self.adapter._last_id, 20)

    async def test_empty_initial_response_does_not_replay_next_page(self):
        self.responses.append({"s": {}})
        self.assertFalse((await self.adapter.poll()).recoverable)
        await self.seed()

    async def test_close_and_configuration(self):
        await self.adapter.close()
        self.assertFalse(self.session.is_closed)  # Borrowed sessions remain caller-owned.
        adapter = DXWatchAdapter()
        self.assertEqual(adapter.base_url, "https://dxwatch.com")
        await adapter.close()  # Also safe before the first poll.
        self.responses.append({"s": {}})
        with patch("coverage_comparator.feeds.dxwatch.httpx.AsyncClient", return_value=self.session):
            await adapter.poll()
        await adapter.close()
        await adapter.close()
        self.assertTrue(self.session.is_closed)
        self.assertEqual(adapter.service, "dxwatch")
        self.assertEqual(adapter.poll_interval, 30)
        for rows in (0, 1001, True):
            with self.assertRaises(ValueError):
                DXWatchAdapter(rows=rows)
