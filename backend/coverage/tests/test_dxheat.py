import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import aiohttp

from coverage_comparator.feeds.dxheat import DXHeatAdapter

NOW = datetime(2026, 11, 3, 22, 35, tzinfo=timezone.utc).timestamp()


def record(nr, **fields):
    return {
        "Nr": nr,
        "Spotter": " w1aw-12 ",
        "DXCall": " ea8/k1abc-2 ",
        "Frequency": "14074.0",
        "Date": "03/11/26",
        "Time": "22:33",
        "Comment": " FT8 CQ ",
        **fields,
    }


class Response:
    def __init__(self, payload):
        self.payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    def raise_for_status(self):
        if isinstance(self.payload, aiohttp.ClientError):
            raise self.payload

    async def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class Session:
    def __init__(self, *payloads):
        self.payloads = iter(payloads)
        self.requests = []
        self.close = AsyncMock()

    def get(self, url, **kwargs):
        self.requests.append((url, kwargs))
        return Response(next(self.payloads))


def adapter(*payloads, **kwargs):
    session = Session(*payloads)
    return DXHeatAdapter(session=session, clock=lambda: NOW, snapshot_limit=10, **kwargs), session


class DXHeatTests(unittest.IsolatedAsyncioTestCase):
    async def test_seed_normalize_overlap_and_order(self):
        feed, session = adapter(
            [record(10)],
            [record(13, Time="22:35"), record(11), record(10), record(12, Time="22:34")],
            [record(12), record(13)],
            base_url="https://example.test/",
        )
        self.assertEqual((await feed.poll()).spots, [])
        snapshot = await feed.poll()
        self.assertTrue(snapshot.recoverable)
        self.assertFalse(snapshot.saturated)
        self.assertEqual([s["time"] for s in snapshot.spots], ["2233Z", "2234Z", "2235Z"])
        self.assertEqual(
            snapshot.spots[0],
            {
                "time": "2233Z",
                "dx_callsign": "EA8/K1ABC",
                "spotter_callsign": "W1AW",
                "frequency": 14074.0,
                "comment": "FT8 CQ",
                "observed_at": NOW,
            },
        )
        self.assertEqual((await feed.poll()).spots, [])
        url, options = session.requests[0]
        self.assertEqual(url, "https://example.test/source/spots/?a=10")
        self.assertIn("HolyCluster", options["headers"]["User-Agent"])
        self.assertEqual(options["timeout"].total, 15)

    async def test_date_parsing_utc_and_midnight_order(self):
        now = datetime(2026, 11, 4, 0, 1, tzinfo=timezone.utc).timestamp()
        session = Session(
            [record(1, Time="23:59")],
            [
                record(3, Date="04/11/26", Time="00:01"),
                record(2, Time="23:59"),
            ],
        )
        feed = DXHeatAdapter(session=session, clock=lambda: now, snapshot_limit=10)
        self.assertTrue((await feed.poll()).recoverable)
        self.assertEqual([s["time"] for s in (await feed.poll()).spots], ["2359Z", "0001Z"])
        parsed = DXHeatAdapter._parse(record(1), NOW)
        self.assertEqual(parsed[1], datetime(2026, 11, 3, 22, 33, tzinfo=timezone.utc).timestamp())

    async def test_malformed_payloads_and_records(self):
        payloads = [None, {}, "<html>", [], ValueError("invalid JSON"), [None], [record(1), record(1)]]
        for field, value in [
            ("Nr", True),
            ("Nr", "1"),
            ("Nr", -1),
            ("Date", "11/31/26"),
            ("Date", "3/11/26"),
            ("Time", "25:00"),
            ("Time", "2:33"),
            ("Frequency", "NaN"),
            ("Frequency", float("inf")),
            ("Frequency", 0),
            ("Frequency", True),
            ("DXCall", None),
            ("Spotter", "<b>W1AW</b>"),
            ("Comment", {}),
        ]:
            payloads.append([record(1, **{field: value})])
        missing = record(1)
        del missing["Time"]
        payloads.append([missing])
        for payload in payloads:
            with self.subTest(payload=payload):
                feed, _ = adapter(payload)
                snapshot = await feed.poll()
                self.assertFalse(snapshot.recoverable)
                self.assertEqual(snapshot.spots, [])

    async def test_full_contiguous_window_is_complete_but_oversize_is_unknown(self):
        session = Session([record(10)], [record(11), record(12)], [record(13), record(14), record(15)])
        feed = DXHeatAdapter(session=session, clock=lambda: NOW, snapshot_limit=2)
        await feed.poll()
        full = await feed.poll()
        self.assertFalse(full.saturated)
        self.assertTrue(full.recoverable)
        self.assertEqual(len(full.spots), 2)
        oversize = await feed.poll()
        self.assertTrue(oversize.saturated)
        self.assertFalse(oversize.recoverable)

    async def test_saturated_gap_reseeds_without_replaying_history(self):
        session = Session([record(10)], [record(12), record(13)], [record(14)])
        feed = DXHeatAdapter(session=session, clock=lambda: NOW, snapshot_limit=2)
        await feed.poll()
        gap = await feed.poll()
        self.assertTrue(gap.saturated)
        self.assertFalse(gap.recoverable)
        recovered = await feed.poll()
        self.assertTrue(recovered.recoverable)
        self.assertEqual(len(recovered.spots), 1)

    async def test_unchanged_snapshot_eventually_becomes_stale(self):
        now = NOW
        session = Session([record(10)], [record(10)])
        feed = DXHeatAdapter(session=session, clock=lambda: now)
        self.assertTrue((await feed.poll()).recoverable)
        now += 301
        self.assertFalse((await feed.poll()).recoverable)

    async def test_gap_marks_unknown_then_reseeds(self):
        feed, _ = adapter([record(10)], [record(12), record(14)], [record(15)])
        await feed.poll()
        gap = await feed.poll()
        self.assertFalse(gap.recoverable)
        self.assertFalse(gap.saturated)
        self.assertEqual(gap.spots, [])
        recovered = await feed.poll()
        self.assertTrue(recovered.recoverable)
        self.assertEqual(len(recovered.spots), 1)

    async def test_missing_overlap_is_ok_only_when_ids_are_contiguous(self):
        feed, _ = adapter([record(10)], [record(11), record(12)])
        await feed.poll()
        self.assertEqual(len((await feed.poll()).spots), 2)

    async def test_id_restart_is_unknown_then_new_generation(self):
        feed, _ = adapter([record(100)], [record(1, Time="22:34")], [record(2, Time="22:35")])
        await feed.poll()
        reset = await feed.poll()
        self.assertFalse(reset.recoverable)
        self.assertEqual(reset.spots, [])
        self.assertEqual(len((await feed.poll()).spots), 1)

    async def test_cached_regression_does_not_reemit_seen_ids(self):
        feed, _ = adapter([record(10)], [record(11)], [record(9)], [record(10), record(11)])
        await feed.poll()
        self.assertEqual(len((await feed.poll()).spots), 1)
        self.assertFalse((await feed.poll()).recoverable)
        self.assertEqual((await feed.poll()).spots, [])

    async def test_stale_and_future_snapshots(self):
        for fields in ({"Time": "22:00"}, {"Date": "02/11/26"}, {"Date": "04/11/26"}):
            with self.subTest(fields=fields):
                feed, _ = adapter([record(1, **fields)])
                snapshot = await feed.poll()
                self.assertFalse(snapshot.recoverable)
                self.assertFalse(snapshot.saturated)

    async def test_transport_errors_do_not_advance_watermark(self):
        feed, _ = adapter([record(10)], aiohttp.ClientError("offline"), [record(11)])
        await feed.poll()
        with self.assertRaises(aiohttp.ClientError):
            await feed.poll()
        self.assertEqual(len((await feed.poll()).spots), 1)

    async def test_dedup_state_does_not_grow(self):
        feed, _ = adapter(*[[record(nr)] for nr in range(1000)])
        for _ in range(1000):
            await feed.poll()
        self.assertEqual(feed._watermark, 999)
        self.assertFalse(any(isinstance(value, (dict, list, set)) for value in vars(feed).values()))

    async def test_close_external_and_owned_sessions(self):
        feed, session = adapter([record(1)])
        await feed.poll()
        await feed.close()
        await feed.close()
        session.close.assert_not_awaited()
        with self.assertRaises(RuntimeError):
            await feed.poll()
        session = Session([record(1)])
        with patch("coverage_comparator.feeds.dxheat.aiohttp.ClientSession", return_value=session):
            feed = DXHeatAdapter(clock=lambda: NOW)
            await feed.poll()
            await feed.close()
            await feed.close()
        session.close.assert_awaited_once()
        feed = DXHeatAdapter()
        await feed.close()  # Closing before the lazy session is created is safe.

    def test_invalid_configuration(self):
        for kwargs in ({"snapshot_limit": 0}, {"stale_after": 0}, {"request_timeout": 0}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                DXHeatAdapter(**kwargs)
