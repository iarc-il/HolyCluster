from unittest import IsolatedAsyncioTestCase

from collectors.metrics import CollectorMetrics
from collectors.telnet.spot_tracking import FINALIZE_SPOT_SCRIPT, RECORD_SPOT_SCRIPT, TelnetSpotTracker

PREFIX = "holycluster_collector_"


class ScriptValkey:
    def __init__(self):
        self.windows = {}
        self.sources = {}
        self.deadlines = {}

    async def eval(self, script, key_count, *values):
        keys = values[:key_count]
        args = values[key_count:]
        if script == RECORD_SPOT_SCRIPT:
            window_key, _ = keys
            source, _, deadline, candidate_window_id, sources_prefix = args
            window_id = self.windows.get(window_key)
            if window_id is None:
                window_id = candidate_window_id
                self.windows[window_key] = window_id
                self.deadlines[window_id] = float(deadline)
            self.sources.setdefault(sources_prefix + window_id, set()).add(source)
            return window_id
        if script == FINALIZE_SPOT_SCRIPT:
            window_key, _, sources_key = keys
            window_id, now = args
            deadline = self.deadlines.get(window_id)
            if deadline is None or deadline > float(now):
                return []
            sources = sorted(self.sources.pop(sources_key, set()))
            self.deadlines.pop(window_id, None)
            if self.windows.get(window_key) == window_id:
                self.windows.pop(window_key)
            return sources
        raise AssertionError("Unexpected script")

    async def zrangebyscore(self, key, minimum, maximum, *, start, num):
        del key, minimum
        due = [window_id for window_id, deadline in self.deadlines.items() if deadline <= float(maximum)]
        return sorted(due)[start : start + num]


class TelnetSpotTrackerTest(IsolatedAsyncioTestCase):
    def setUp(self):
        self.now = 0
        self.valkey = ScriptValkey()
        self.metrics = CollectorMetrics()
        self.tracker = TelnetSpotTracker(
            self.valkey,
            collector_metrics=self.metrics,
            window_seconds=60,
            clock=lambda: self.now,
        )

    def value(self, name, **labels):
        return self.metrics.registry.get_sample_value(PREFIX + name, labels)

    async def test_repeated_reports_from_one_source_finalize_as_unique(self):
        await self.tracker.record("2010Z:K1ABC:14074.0:W1XYZ", "DXUSA")
        self.now = 30
        await self.tracker.record("2010Z:K1ABC:14074.0:W1XYZ", "DXUSA")
        self.now = 60

        self.assertEqual(await self.tracker.finalize_due(), 1)
        self.assertEqual(self.value("telnet_unique_spots_total", source="DXUSA"), 1)
        self.assertEqual(self.value("telnet_spots_by_source_count_total", source_count="1"), 1)

    async def test_distinct_sources_finalize_in_one_source_count_bucket(self):
        spot_key = "2010Z:K1ABC:14074.0:W1XYZ"
        await self.tracker.record(spot_key, "DXUSA")
        self.now = 59
        await self.tracker.record(spot_key, "K7AR")
        await self.tracker.record(spot_key, "K7AR")
        self.now = 60

        self.assertEqual(await self.tracker.finalize_due(), 1)
        self.assertIsNone(self.value("telnet_unique_spots_total", source="DXUSA"))
        self.assertIsNone(self.value("telnet_unique_spots_total", source="K7AR"))
        self.assertEqual(self.value("telnet_spots_by_source_count_total", source_count="2"), 1)

    async def test_pending_window_can_be_finalized_by_a_new_tracker(self):
        await self.tracker.record("2010Z:K1ABC:14074.0:W1XYZ", "DXUSA")
        restarted_tracker = TelnetSpotTracker(
            self.valkey,
            collector_metrics=self.metrics,
            window_seconds=60,
            clock=lambda: self.now,
        )
        self.now = 60

        self.assertEqual(await restarted_tracker.finalize_due(), 1)
        self.assertEqual(self.value("telnet_unique_spots_total", source="DXUSA"), 1)

    async def test_report_after_finalization_starts_a_new_window(self):
        spot_key = "2010Z:K1ABC:14074.0:W1XYZ"
        await self.tracker.record(spot_key, "DXUSA")
        self.now = 60
        await self.tracker.finalize_due()
        await self.tracker.record(spot_key, "K7AR")
        self.now = 120

        self.assertEqual(await self.tracker.finalize_due(), 1)
        self.assertEqual(self.value("telnet_unique_spots_total", source="DXUSA"), 1)
        self.assertEqual(self.value("telnet_unique_spots_total", source="K7AR"), 1)
        self.assertEqual(self.value("telnet_spots_by_source_count_total", source_count="1"), 2)
