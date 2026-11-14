import unittest
from datetime import UTC, datetime

import httpx

from coverage_comparator.feeds.dxscape import DXscapeAdapter

NOW = datetime(2026, 11, 13, 21, 45, tzinfo=UTC).timestamp()


def row(dx="DX1AA", spot_time="2144Z", frequency="14074.0", comment="CQ DX", spotter="W1AW-12"):
    return f"{dx:<12.12} {spot_time} {str(frequency):>8.8} {comment:<32.32}{spotter:<10}"


def page(*rows, footer="Fri Nov 13 21:45:00 UTC 2026", title="DXSCAPE Web cluster"):
    body = "\n".join(rows)
    return f"""<html><head><title>{title}</title></head><body>
<pre>
{body}
Sat Nov 14 06:45:00 JST 2026
{footer}
</pre>
</body></html>"""


class DXscapeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.now = NOW
        self.responses = []
        self.requests = []

        def handle(request):
            self.requests.append(request)
            response = self.responses.pop(0)
            return response if isinstance(response, httpx.Response) else httpx.Response(200, text=response)

        self.session = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        self.adapter = DXscapeAdapter(
            session=self.session,
            base_url="http://example.test/",
            clock=lambda: self.now,
            snapshot_limit=3,
        )

    async def asyncTearDown(self):
        await self.adapter.close()
        await self.session.aclose()

    async def poll(self, body, *, advance=60):
        self.now += advance
        self.responses.append(body)
        return await self.adapter.poll()

    async def test_seed_overlap_normalization_and_order(self):
        self.responses.append(page(row("DX1AA", "2144Z", spotter="W1AW-12")))
        seeded = await self.adapter.poll()
        self.assertFalse(seeded.recoverable)
        self.assertEqual(seeded.spots, [])
        request = self.requests[0]
        self.assertEqual(str(request.url), "http://example.test/ww.html")
        self.assertIn("Firefox/", request.headers["User-Agent"])
        self.assertEqual(request.extensions["timeout"]["read"], 15.0)

        snapshot = await self.poll(
            page(
                row("DX3AA", "2146Z", "7010.5", "A - B", "K1ABC-9").replace("A - B", "A &#45; B"),
                row("DX2AA", "2145Z", "14074.0", "linked", "N0CALL"),
                row("DX1AA", "2144Z", spotter="W1AW-12"),
                footer="Fri Nov 13 21:46:00 UTC 2026",
            )
        )
        self.assertTrue(snapshot.recoverable)
        self.assertFalse(snapshot.saturated)
        self.assertEqual([spot["dx_callsign"] for spot in snapshot.spots], ["DX2AA", "DX3AA"])
        self.assertEqual(
            snapshot.spots[1],
            {
                "time": "2146Z",
                "dx_callsign": "DX3AA",
                "spotter_callsign": "K1ABC",
                "frequency": 7010.5,
                "comment": "A - B",
                "observed_at": datetime(2026, 11, 13, 21, 46, tzinfo=UTC).timestamp(),
            },
        )

    async def test_linked_callsign_and_midnight_rollover(self):
        linked = row("DX2AA", "0001Z", spotter="K1ABC").replace("DX2AA       ", '<a href="x">DX2AA</a>       ')
        self.now = datetime(2026, 11, 14, 0, 2, tzinfo=UTC).timestamp()
        self.responses.append(
            page(
                linked,
                row("DX1AA", "2359Z"),
                footer="Sat Nov 14 00:02:00 UTC 2026",
            )
        )
        await self.adapter.poll()
        snapshot = await self.poll(
            page(
                row("DX3AA", "0002Z"),
                linked,
                row("DX1AA", "2359Z"),
                footer="Sat Nov 14 00:03:00 UTC 2026",
            )
        )
        self.assertTrue(snapshot.recoverable)
        self.assertEqual(snapshot.spots[0]["observed_at"], datetime(2026, 11, 14, 0, 2, tzinfo=UTC).timestamp())

    async def test_unchanged_snapshot_is_healthy(self):
        body = page(row())
        self.responses.append(body)
        await self.adapter.poll()
        snapshot = await self.poll(body)
        self.assertTrue(snapshot.recoverable)
        self.assertEqual(snapshot.spots, [])

    async def test_malformed_rows_do_not_take_feed_down(self):
        self.adapter.snapshot_limit = 6
        self.responses.append(page(row("DX1AA", "2144Z")))
        await self.adapter.poll()
        snapshot = await self.poll(
            page(
                row("BADTIME", "2152Z"),
                row("BADFREQ", "2146Z", frequency="nan"),
                row("", "2146Z"),
                "malformed row",
                row("DX2AA", "2145Z"),
                row("DX1AA", "2144Z"),
                footer="Fri Nov 13 21:46:00 UTC 2026",
            )
        )
        self.assertTrue(snapshot.recoverable)
        self.assertEqual([spot["dx_callsign"] for spot in snapshot.spots], ["DX2AA"])

    async def test_missing_or_ambiguous_overlap_rebases(self):
        self.responses.append(page(row("DX1AA", "2144Z"), row("DX0AA", "2143Z")))
        await self.adapter.poll()
        missing = await self.poll(
            page(
                row("DX4AA", "2147Z"),
                row("DX3AA", "2146Z"),
                row("DX2AA", "2145Z"),
                footer="Fri Nov 13 21:47:00 UTC 2026",
            ),
            advance=120,
        )
        self.assertFalse(missing.recoverable)
        self.assertTrue(missing.saturated)
        recovered = await self.poll(
            page(
                row("DX5AA", "2148Z"),
                row("DX4AA", "2147Z"),
                row("DX3AA", "2146Z"),
                footer="Fri Nov 13 21:48:00 UTC 2026",
            )
        )
        self.assertTrue(recovered.recoverable)
        self.assertEqual([spot["dx_callsign"] for spot in recovered.spots], ["DX5AA"])

        duplicate = row("SAME", "2148Z")
        self.adapter._previous = None
        self.responses.append(page(duplicate, duplicate))
        await self.adapter.poll()
        ambiguous = await self.poll(page(duplicate, duplicate, duplicate, footer="Fri Nov 13 21:49:00 UTC 2026"))
        self.assertFalse(ambiguous.recoverable)
        self.assertEqual(ambiguous.spots, [])

    async def test_invalid_pages_do_not_advance_state(self):
        self.responses.append(page(row("DX1AA")))
        await self.adapter.poll()
        previous = self.adapter._previous
        cases = (
            "not html",
            page(row(), title="Challenge"),
            "<title>DXSCAPE Web cluster</title><pre>missing footer</pre>",
            page(row(spot_time="2500Z")),
            page(),
        )
        for body in cases:
            with self.subTest(body=body):
                snapshot = await self.poll(body)
                self.assertFalse(snapshot.recoverable)
                self.assertEqual(snapshot.spots, [])
                self.assertIs(self.adapter._previous, previous)

    async def test_stale_future_oversized_and_transport_failure(self):
        for footer in ("Fri Nov 13 21:40:00 UTC 2026", "Fri Nov 13 21:50:00 UTC 2026"):
            self.responses.append(page(row(), footer=footer))
            snapshot = await self.adapter.poll()
            self.assertFalse(snapshot.recoverable)
            self.assertEqual(snapshot.spots, [])
            self.now += 60

        self.responses.append(httpx.Response(200, content=b"x" * (self.adapter.MAX_BYTES + 1)))
        self.assertFalse((await self.adapter.poll()).recoverable)
        self.now += 60
        self.responses.append(httpx.Response(503))
        with self.assertRaises(httpx.HTTPStatusError):
            await self.adapter.poll()

    async def test_requests_are_rate_limited_and_close_is_safe(self):
        self.responses.append(page(row()))
        await self.adapter.poll()
        self.assertFalse((await self.adapter.poll()).recoverable)
        self.assertEqual(len(self.requests), 1)
        await self.adapter.close()
        await self.adapter.close()
        self.assertFalse(self.session.is_closed)
        with self.assertRaises(RuntimeError):
            await self.adapter.poll()

        owned = DXscapeAdapter()
        await owned.close()

    def test_invalid_configuration(self):
        for kwargs in (
            {"poll_interval": 59.9},
            {"snapshot_limit": 0},
            {"stale_after": 0},
            {"request_timeout": 0},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                DXscapeAdapter(**kwargs)
