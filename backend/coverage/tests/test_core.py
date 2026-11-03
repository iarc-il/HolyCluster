import json
import unittest

import fakeredis.aioredis
from prometheus_client import CollectorRegistry, generate_latest

from coverage_comparator.adapters import FakeAdapter, Snapshot
from coverage_comparator.matcher import Matcher
from coverage_comparator.metrics import Metrics
from coverage_comparator.samples import MemorySampleSink
from coverage_comparator.service import consume_snapshot

SPOT = {"time": "1200", "dx_callsign": "4X1AA", "frequency": 14074.0, "spotter_callsign": "W1AA"}
SERVICES = ("dxsummit", "dxheat", "dxwatch", "dxdata", "hamqth")


class MatcherTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
        self.registry = CollectorRegistry()
        self.metrics = Metrics(self.registry)
        self.sink = MemorySampleSink()
        self.matcher = Matcher(self.redis, self.metrics, self.sink)
        for source in ("holy", *SERVICES):
            await self.matcher.health(source, True, 0)
            await self.matcher.health(source, True, 60)

    async def asyncTearDown(self):
        await self.redis.aclose()

    def count(self, service, result):
        return self.registry.get_sample_value(
            "holycluster_coverage_outcomes_total", {"service": service, "result": result}
        ) or 0

    async def test_either_order_and_repeat_dedupe(self):
        for first, second in (("holy", "dxsummit"), ("dxsummit", "holy")):
            with self.subTest(first=first):
                await self.redis.flushall()
                await self.asyncSetUp()
                await self.matcher.observe(first, SPOT, 60)
                await self.matcher.observe(first, SPOT, 90)
                await self.matcher.observe(second, SPOT, 119)
                await self.matcher.finalize(120)
                self.assertEqual(self.count("dxsummit", "matched"), 1)
                self.assertEqual(self.count("dxsummit", "holy_only"), 0)

    async def test_exact_boundary_and_new_window(self):
        await self.matcher.observe("holy", SPOT, 60)
        await self.matcher.finalize(119.999)
        self.assertEqual(self.count("dxsummit", "holy_only"), 0)
        await self.matcher.observe("dxsummit", SPOT, 120)
        self.assertEqual(self.count("dxsummit", "holy_only"), 1)
        await self.matcher.finalize(180)
        self.assertEqual(self.count("dxsummit", "service_only"), 1)
        self.assertEqual(len(self.sink.samples), 6)

    async def test_pairwise_and_absent_sides(self):
        await self.matcher.observe("dxsummit", SPOT, 60)
        await self.matcher.finalize(120)
        self.assertEqual(self.count("dxsummit", "service_only"), 1)
        self.assertEqual(self.count("dxheat", "service_only"), 0)
        await self.matcher.observe("holy", SPOT, 121)
        await self.matcher.observe("dxheat", SPOT, 122)
        await self.matcher.finalize(181)
        self.assertEqual(self.count("dxheat", "matched"), 1)
        self.assertEqual(self.count("dxwatch", "holy_only"), 1)

    async def test_health_generation_failure_and_recovery_skip(self):
        await self.matcher.observe("holy", SPOT, 60)
        await self.matcher.health("dxsummit", False, 70)
        await self.matcher.health("dxsummit", True, 71)
        await self.matcher.finalize(131)
        self.assertEqual(self.count("dxsummit", "holy_only"), 0)
        self.assertEqual(self.count("dxheat", "holy_only"), 1)

    async def test_startup_stale_and_saturated_skip(self):
        await self.matcher.restart(60)
        await self.matcher.observe("holy", SPOT, 61)
        await self.matcher.finalize(121)
        self.assertEqual(self.count("dxsummit", "holy_only"), 0)
        for source in ("holy", *SERVICES):
            await self.matcher.health(source, True, 122)
            await self.matcher.health(source, True, 182)
        await self.matcher.observe("holy", SPOT, 182)
        await self.matcher.health("dxsummit", True, 190, saturated=True)
        await self.matcher.finalize(242)
        self.assertEqual(self.count("dxsummit", "holy_only"), 0)
        await self.matcher.observe("dxheat", SPOT, 400)
        await self.matcher.finalize(460)
        self.assertEqual(self.count("dxheat", "service_only"), 0)

    async def test_restart_recovers_windows_and_stream_dedupe(self):
        await self.matcher.observe("holy", SPOT, 60, event_id="60000-0")
        recovered = Matcher(self.redis, self.metrics, self.sink)
        await recovered.observe("holy", SPOT, 120, event_id="60000-0")
        await recovered.finalize(180)
        self.assertEqual(self.count("dxsummit", "holy_only"), 1)
        self.assertEqual(len(self.sink.samples), 5)

    async def test_labels_are_bounded(self):
        with self.assertRaises(ValueError):
            await self.matcher.observe("arbitrary-user-value", SPOT, 60)
        await self.matcher.observe("holy", SPOT, 60)
        await self.matcher.finalize(120)
        for family in self.registry.collect():
            for sample in family.samples:
                self.assertLessEqual(set(sample.labels), {"service", "result", "reason"})
                if "service" in sample.labels:
                    self.assertIn(sample.labels["service"], ("holy", *SERVICES))
        self.assertNotIn(b"4X1AA", generate_latest(self.registry))

    async def test_fake_adapter_end_to_end(self):
        adapter = FakeAdapter("dxsummit", [Snapshot([SPOT])])
        await self.matcher.observe("holy", SPOT, 60)
        await consume_snapshot(self.matcher, adapter.service, await adapter.poll(), 61)
        await self.matcher.observe("holy", {**SPOT, "dx_callsign": "4X2AA"}, 62)
        await self.matcher.finalize(122)
        self.assertEqual(self.count("dxsummit", "matched"), 1)
        self.assertEqual(self.count("dxsummit", "holy_only"), 1)
        self.assertTrue(any(s["spot"]["dx_callsign"] == "4X2AA" for s in self.sink.samples.values()))
        self.assertIn(b'holycluster_coverage_outcomes_total{result="matched",service="dxsummit"} 1.0',
                      generate_latest(self.registry))

    async def test_state_is_bounded(self):
        matcher = Matcher(self.redis, self.metrics, self.sink, max_windows=1)
        await matcher.observe("holy", SPOT, 60)
        await matcher.observe("holy", {**SPOT, "time": "1201"}, 61)
        await matcher.finalize(120)
        self.assertEqual(self.count("dxsummit", "holy_only"), 0)
        state = json.loads(await self.redis.get("coverage:state"))
        self.assertLessEqual(len(state["windows"]), 1)
