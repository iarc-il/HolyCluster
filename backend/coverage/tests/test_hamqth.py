import unittest
from datetime import UTC, datetime

import httpx

from coverage_comparator.feeds.hamqth import HamQTHAdapter

NOW = datetime(2026, 11, 3, 22, 33, tzinfo=UTC).timestamp()


def record(age=0, call="dx1aa", **fields):
    return {
        "spotter": " w1ab-12 ",
        "dxcall": call,
        "freq": "14074.5",
        "time": datetime.fromtimestamp(NOW - age, UTC).isoformat().replace("+00:00", "Z"),
        "remarks": "CQ DX",
        **fields,
    }


class HamQTHTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.now = NOW
        self.payload = {"spots": [record()]}
        self.requests = []

        def respond(request):
            self.requests.append(request)
            return httpx.Response(200, json=self.payload)

        self.session = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        self.adapter = HamQTHAdapter(self.session, "https://example.test/", lambda: self.now)

    async def asyncTearDown(self):
        await self.adapter.close()

    async def poll(self, spots):
        self.now += 15
        self.payload = {"spots": spots}
        return await self.adapter.poll()

    async def test_public_api_shape_and_initial_seed(self):
        snapshot = await self.adapter.poll()
        self.assertEqual(snapshot.spots, [])
        self.assertFalse(snapshot.recoverable)
        request = self.requests[0]
        self.assertEqual(request.method, "GET")
        self.assertEqual(str(request.url), "https://example.test/api/v2/spots?limit=200")
        self.assertIn("Firefox/", request.headers["User-Agent"])
        self.assertEqual(self.adapter.service, "hamqth")

    async def test_normalization_overlap_and_chronological_order(self):
        await self.adapter.poll()
        snapshot = await self.poll([record(-10, "dx3aa"), record(), record(-5, "dx2aa")])
        self.assertTrue(snapshot.recoverable)
        self.assertEqual([s["dx_callsign"] for s in snapshot.spots], ["DX2AA", "DX3AA"])
        self.assertEqual(
            snapshot.spots[0],
            {
                "time": "2233Z",
                "spotter_callsign": "W1AB",
                "dx_callsign": "DX2AA",
                "frequency": 14074.5,
                "comment": "CQ DX",
                "observed_at": NOW + 5,
            },
        )
        snapshot = await self.poll([record(-10, "DX3AA", spotter="W1AB"), record(-5, "dx2aa")])
        self.assertEqual(snapshot.spots, [])

    async def test_poll_policy_and_close(self):
        with self.assertRaises(ValueError):
            HamQTHAdapter(poll_interval=14.9)
        await self.adapter.poll()
        self.assertFalse((await self.adapter.poll()).recoverable)
        self.now += 14.9
        await self.adapter.poll()
        self.assertEqual(len(self.requests), 1)
        self.now += 0.1
        await self.adapter.poll()
        self.assertEqual(len(self.requests), 2)
        await self.adapter.close()
        await self.adapter.close()
        self.assertTrue(self.session.is_closed)
        with self.assertRaises(RuntimeError):
            await self.adapter.poll()

    async def test_saturation_at_exactly_200(self):
        await self.adapter.poll()
        snapshot = await self.poll([record(call=f"DX{i}") for i in range(200)])
        self.assertTrue(snapshot.saturated)
        snapshot = await self.poll([record(call=f"DX{i}") for i in range(201)])
        self.assertTrue(snapshot.saturated)
        self.assertFalse(snapshot.recoverable)

    async def test_malformed_shapes(self):
        for payload in ([], {}, {"spots": None}, {"spots": {}}, {"spots": [None]}):
            with self.subTest(payload=payload):
                self.now += 15
                self.payload = payload
                snapshot = await self.adapter.poll()
                self.assertFalse(snapshot.recoverable)
                self.assertEqual(snapshot.spots, [])

    async def test_bad_records_invalidate_whole_snapshot(self):
        await self.adapter.poll()
        for bad in (
            record(time="2233Z"),
            record(time="2026-11-03T22:33:00"),
            record(time="2026-11-03T22:33:00+02:00"),
            record(-1000),
            record(1000),
            record(freq="nan"),
            record(freq=True),
            record(dxcall=None),
            record(comment=[]),
        ):
            with self.subTest(bad=bad):
                snapshot = await self.poll([record(), bad])
                self.assertFalse(snapshot.recoverable)
                self.assertEqual(snapshot.spots, [])

    async def test_stale_empty_and_gap(self):
        await self.adapter.poll()
        self.now += 121
        snapshot = await self.poll([record()])
        self.assertFalse(snapshot.recoverable)
        self.assertFalse((await self.poll([])).recoverable)
        self.now += 601
        current = record(time=datetime.fromtimestamp(self.now, UTC).isoformat())
        snapshot = await self.poll([current])
        self.assertFalse(snapshot.recoverable)
        self.assertEqual(snapshot.spots, [])
        self.assertTrue((await self.poll([current])).recoverable)

    async def test_bounded_time_aware_cache(self):
        self.adapter.max_cache = 200
        await self.adapter.poll()
        snapshot = await self.poll([record(-10, f"DX{i}") for i in range(200)])
        self.assertFalse(snapshot.recoverable)  # cache overflow is not complete
        self.assertLessEqual(len(self.adapter._seen), 200)
        snapshot = await self.poll([record()])  # evicted history must not reappear
        self.assertFalse(snapshot.recoverable)
        self.assertEqual(snapshot.spots, [])
        self.now += 601
        current = record(time=datetime.fromtimestamp(self.now, UTC).isoformat())
        await self.poll([current])
        self.assertEqual(len(self.adapter._seen), 1)

    async def test_response_byte_bound_and_invalid_json(self):
        await self.session.aclose()
        for body in (b"not JSON", b"x" * (self.adapter.MAX_BYTES + 1)):
            self.adapter.session = httpx.AsyncClient(
                transport=httpx.MockTransport(lambda request: httpx.Response(200, content=body))
            )
            self.now += 15
            self.assertFalse((await self.adapter.poll()).recoverable)
            await self.adapter.session.aclose()

    async def test_failed_requests_are_rate_limited(self):
        await self.session.aclose()
        self.adapter.session = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(503)))
        with self.assertRaises(httpx.HTTPStatusError):
            await self.adapter.poll()
        self.assertFalse((await self.adapter.poll()).recoverable)
