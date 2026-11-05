import json
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from coverage_comparator.adapters import identity
from coverage_comparator.feeds.dxsummit import DXSummitAdapter


def record(number, **changes):
    return {
        "id": number,
        "time": f"2026-11-03T22:33:{number:02}",
        "dx_call": "bd3ct",
        "de_call": "ad1c-12",
        "frequency": 21074,
        "comment": "FT8",
        **changes,
    }


class Response:
    def __init__(self, payload):
        self.body = json.dumps(payload).encode()
        self.content = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    def raise_for_status(self):
        pass

    async def iter_chunked(self, size):
        for offset in range(0, len(self.body), size):
            yield self.body[offset : offset + size]


class Session:
    def __init__(self, *payloads):
        self.responses = iter(payloads)
        self.calls = []
        self.close = AsyncMock()

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return Response(next(self.responses))


class DXSummitTests(unittest.IsolatedAsyncioTestCase):
    def adapter(self, *payloads, **kwargs):
        session = Session(*payloads)
        return DXSummitAdapter(session=session, clock=lambda: 1800000000, **kwargs), session

    def test_normalization_and_identity(self):
        _, spot = DXSummitAdapter._normalize(record(1))
        self.assertEqual(
            spot,
            {
                "time": "2233Z",
                "dx_callsign": "BD3CT",
                "spotter_callsign": "AD1C",
                "frequency": 21074.0,
                "comment": "FT8",
                "observed_at": datetime(2026, 11, 3, 22, 33, 1, tzinfo=timezone.utc).timestamp(),
            },
        )
        self.assertEqual(identity(spot), "BD3CT:21074.0:AD1C")
        _, other = DXSummitAdapter._normalize(record(2, comment="changed"))
        self.assertEqual(identity(spot), identity(other))
        self.assertEqual(
            identity(
                {
                    **spot,
                    "time": "2234Z",
                    "dx_callsign": "bd3ct",
                    "frequency": "21074.00",
                    "spotter_callsign": "ad1c-12",
                }
            ),
            identity(spot),
        )
        _, other = DXSummitAdapter._normalize(record(2, de_call="ad1c-A", comment=None))
        self.assertEqual(other["spotter_callsign"], "AD1C-A")
        self.assertEqual(other["comment"], "")
        upstream = record(1, info="CW")
        del upstream["comment"]
        self.assertEqual(DXSummitAdapter._normalize(upstream)[1]["comment"], "CW")

    def test_naive_time_is_utc_and_offsets_are_converted(self):
        naive = DXSummitAdapter._normalize(record(1))[1]
        for timestamp in ("2026-11-03T22:33:01Z", "2026-11-04T00:33:01+02:00"):
            self.assertEqual(DXSummitAdapter._normalize(record(1, time=timestamp))[1], naive)

    async def test_seed_overlap_order_and_exactly_once(self):
        adapter, session = self.adapter(
            [record(2), record(1)],
            [record(4), record(2), record(3), record(3)],
            [record(4), record(3)],
            [record(5), record(4)],
            base_url="https://example.invalid/",
        )
        seed = await adapter.poll()
        self.assertEqual(seed.spots, [])
        self.assertFalse(seed.recoverable)
        new = await adapter.poll()
        self.assertTrue(new.recoverable)
        self.assertEqual(
            [spot["observed_at"] for spot in new.spots],
            [DXSummitAdapter._normalize(record(i))[1]["observed_at"] for i in (3, 4)],
        )
        self.assertEqual((await adapter.poll()).spots, [])
        self.assertEqual(len((await adapter.poll()).spots), 1)
        url, request = session.calls[1]
        self.assertEqual(url, "https://example.invalid/api/v1/spots")
        self.assertEqual(request["params"]["from_time"], int(adapter._normalize(record(2))[1]["observed_at"]) - 120)
        self.assertEqual(request["params"]["to_time"], 1800000001)
        self.assertEqual(request["params"]["limit"], 1000)
        self.assertIn("Firefox/", request["headers"]["User-Agent"])
        self.assertLess(request["timeout"].total, adapter.poll_interval)

    async def test_invalid_record_rejects_whole_poll_without_cursor_change(self):
        invalid = [
            None,
            {},
            record(True),
            record(3, frequency="nan"),
            record(3, frequency=True),
            record(3, time="bad"),
            record(3, de_call=""),
            record(3, comment=[]),
            record(3, id=2**64),
            record(3, dx_call="x" * 65),
        ]
        for bad in invalid:
            with self.subTest(bad=bad):
                adapter, _ = self.adapter([record(1)], [record(2), bad, record(1)], [record(2), record(1)])
                await adapter.poll()
                snapshot = await adapter.poll()
                self.assertFalse(snapshot.recoverable)
                self.assertEqual(snapshot.spots, [])
                self.assertEqual(len((await adapter.poll()).spots), 1)

    async def test_invalid_payload_and_empty_response_are_unknown(self):
        for payload in ({"spots": []}, None, "bad", []):
            adapter, _ = self.adapter(payload)
            self.assertFalse((await adapter.poll()).recoverable)

    async def test_saturation_rebases_but_never_emits_partial_data(self):
        adapter, _ = self.adapter([record(1)], [record(3), record(2), record(1)], [record(4), record(3)], limit=3)
        await adapter.poll()
        saturated = await adapter.poll()
        self.assertTrue(saturated.saturated)
        self.assertFalse(saturated.recoverable)
        self.assertEqual(saturated.spots, [])
        self.assertEqual(len((await adapter.poll()).spots), 1)

    async def test_saturated_seed_is_not_complete(self):
        adapter, _ = self.adapter([record(2), record(1)], limit=2)
        snapshot = await adapter.poll()
        self.assertTrue(snapshot.saturated)
        self.assertEqual(snapshot.spots, [])

    async def test_gap_rebases_without_replaying_history(self):
        adapter, _ = self.adapter([record(1)], [record(4), record(3)], [record(5), record(4)])
        await adapter.poll()
        gap = await adapter.poll()
        self.assertFalse(gap.recoverable)
        self.assertEqual(gap.spots, [])
        self.assertEqual(len((await adapter.poll()).spots), 1)

    async def test_cursor_regression_does_not_replay_old_ids(self):
        adapter, _ = self.adapter([record(3)], [record(2), record(1)], [record(4), record(3)])
        await adapter.poll()
        self.assertFalse((await adapter.poll()).recoverable)
        self.assertEqual(adapter._cursor, 3)
        self.assertEqual(len((await adapter.poll()).spots), 1)

    async def test_late_timestamp_is_unknown(self):
        adapter, _ = self.adapter([record(3)], [record(4, time=record(1)["time"]), record(3)])
        await adapter.poll()
        self.assertFalse((await adapter.poll()).recoverable)

    async def test_conflicting_duplicate_id_is_unknown(self):
        adapter, _ = self.adapter([record(1)], [record(2), record(2, comment="other"), record(1)])
        await adapter.poll()
        self.assertFalse((await adapter.poll()).recoverable)

    async def test_oversized_response_is_unknown(self):
        adapter, _ = self.adapter([record(1)])
        adapter.max_response_bytes = 10
        snapshot = await adapter.poll()
        self.assertTrue(snapshot.saturated)
        self.assertFalse(snapshot.recoverable)

    async def test_invalid_json_does_not_move_cursor(self):
        adapter, session = self.adapter()
        response = Response(None)
        response.body = b"[{"
        with patch.object(session, "get", return_value=response):
            self.assertFalse((await adapter.poll()).recoverable)
        self.assertIsNone(adapter._cursor)

    async def test_order_uses_timestamp_not_response_order_or_id(self):
        adapter, _ = self.adapter(
            [record(1)],
            [record(2, time=record(4)["time"]), record(3), record(1)],
            [record(4, time=record(2)["time"]), record(3)],
        )
        await adapter.poll()
        snapshot = await adapter.poll()
        self.assertTrue(snapshot.recoverable)
        self.assertEqual(
            [spot["observed_at"] for spot in snapshot.spots],
            [DXSummitAdapter._normalize(record(i))[1]["observed_at"] for i in (3, 4)],
        )
        # A later response must not go back behind the last emitted timestamp.
        self.assertFalse((await adapter.poll()).recoverable)

    async def test_server_limit_violation_is_not_complete(self):
        adapter, _ = self.adapter([record(3), record(2), record(1)], limit=2)
        snapshot = await adapter.poll()
        self.assertTrue(snapshot.saturated)
        self.assertFalse(snapshot.recoverable)
        self.assertIsNone(adapter._cursor)

    async def test_owned_session_close_is_idempotent(self):
        session = Session([record(1)])
        with patch("coverage_comparator.feeds.dxsummit.aiohttp.ClientSession", return_value=session):
            adapter = DXSummitAdapter()
            await adapter.poll()
            await adapter.close()
            await adapter.close()
        session.close.assert_awaited_once()
        with self.assertRaises(RuntimeError):
            await adapter.poll()

    async def test_borrowed_session_is_not_closed(self):
        adapter, session = self.adapter()
        await adapter.close()
        session.close.assert_not_awaited()
