import unittest
from unittest.mock import AsyncMock

import fakeredis.aioredis
from prometheus_client import CollectorRegistry

from coverage_comparator.adapters import FakeAdapter, Snapshot
from coverage_comparator.consumer import HolyConsumer
from coverage_comparator.matcher import Matcher
from coverage_comparator.metrics import Metrics
from coverage_comparator.samples import MemorySampleSink
from coverage_comparator.service import consume_snapshot

SPOT = {"time": "1200", "dx_callsign": "4X1AA", "frequency": "14074.0", "spotter_callsign": "W1AA"}


class ConsumerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
        self.registry = CollectorRegistry()
        self.matcher = Matcher(self.redis, Metrics(self.registry), MemorySampleSink())
        self.consumer = HolyConsumer(self.redis, self.matcher, clock=lambda: 60)
        await self.consumer.prepare()

    async def asyncTearDown(self):
        await self.redis.aclose()

    async def test_pending_recovery_after_processing_before_ack(self):
        event_id = await self.redis.xadd("coverage-holy", SPOT, id="60000-0")
        records = await self.redis.xreadgroup(self.consumer.group, "old-process", {"coverage-holy": ">"})
        await self.matcher.observe("holy", SPOT, 60, event_id=event_id)
        self.assertTrue(records)
        await self.consumer.recover()
        self.assertEqual(await self.redis.xlen("coverage-holy"), 0)
        self.assertEqual((await self.redis.xpending("coverage-holy", self.consumer.group))["pending"], 0)
        state = await self.redis.get("coverage:state")
        self.assertIn('"last_event_id": "60000-0"', state)

    async def test_failure_keeps_pending_and_record(self):
        await self.redis.xadd("coverage-holy", SPOT, id="60000-0")
        records = await self.redis.xreadgroup(self.consumer.group, "comparator", {"coverage-holy": ">"})
        self.matcher.observe = AsyncMock(side_effect=RuntimeError("store unavailable"))
        with self.assertRaises(RuntimeError):
            await self.consumer.process(records)
        self.assertEqual(await self.redis.xlen("coverage-holy"), 1)
        self.assertEqual((await self.redis.xpending("coverage-holy", self.consumer.group))["pending"], 1)

    async def test_saturated_stream_invalidates_comparison(self):
        for source in ("holy", "dxsummit"):
            await self.matcher.health(source, True, 0)
            await self.matcher.health(source, True, 60)
        await self.matcher.observe("dxsummit", SPOT, 60)
        consumer = HolyConsumer(self.redis, self.matcher, clock=lambda: 61, max_stream_length=1)
        await self.redis.xadd("coverage-holy", SPOT, id="61000-0")
        records = await self.redis.xreadgroup(consumer.group, "comparator", {"coverage-holy": ">"})
        await consumer.process(records)
        await self.matcher.finalize(121)
        self.assertEqual(self.registry.get_sample_value(
            "holycluster_coverage_outcomes_total", {"service": "dxsummit", "result": "matched"}), 0)
        self.assertEqual(self.registry.get_sample_value(
            "holycluster_coverage_snapshot_saturated_total", {"service": "holy"}), 1)

    async def test_recovery_invalidates_health_before_read(self):
        await self.matcher.health("holy", True, 0)
        await self.matcher.health("dxsummit", True, 0)
        await self.matcher.health("holy", True, 60)
        await self.matcher.health("dxsummit", True, 60)
        await self.matcher.observe("holy", SPOT, 60)
        await self.consumer.recover()
        await self.matcher.health("holy", True, 61)
        await self.matcher.finalize(121)
        self.assertEqual(self.registry.get_sample_value(
            "holycluster_coverage_outcomes_total", {"service": "dxsummit", "result": "holy_only"}), 0)

    async def test_stream_and_fake_adapter_reach_metrics_and_sink(self):
        sink = self.matcher.sink
        for source in ("holy", "dxsummit"):
            await self.matcher.health(source, True, 0)
            await self.matcher.health(source, True, 60)
        adapter = FakeAdapter("dxsummit", [Snapshot([SPOT])])
        await self.redis.xadd("coverage-holy", SPOT, id="60000-0")
        records = await self.redis.xreadgroup(self.consumer.group, "comparator", {"coverage-holy": ">"})
        await self.consumer.process(records)
        await consume_snapshot(self.matcher, adapter.service, await adapter.poll(), 60)
        self.consumer.clock = lambda: 61
        await self.redis.xadd("coverage-holy", {**SPOT, "dx_callsign": "4X2AA"}, id="61000-0")
        records = await self.redis.xreadgroup(self.consumer.group, "comparator", {"coverage-holy": ">"})
        await self.consumer.process(records)
        await self.matcher.finalize(121)
        self.assertEqual(self.registry.get_sample_value(
            "holycluster_coverage_outcomes_total", {"service": "dxsummit", "result": "matched"}), 1)
        self.assertEqual(self.registry.get_sample_value(
            "holycluster_coverage_outcomes_total", {"service": "dxsummit", "result": "holy_only"}), 1)
        self.assertEqual(len(sink.samples), 1)
        self.assertEqual(next(iter(sink.samples.values()))["spot"]["dx_callsign"], "4X2AA")

    async def test_stale_holy_record_is_not_compared(self):
        await self.redis.xadd("coverage-holy", SPOT, id="1-0")
        records = await self.redis.xreadgroup(self.consumer.group, "comparator", {"coverage-holy": ">"})
        self.consumer.clock = lambda: 1000
        await self.consumer.process(records)
        self.assertEqual(self.registry.get_sample_value("holycluster_coverage_feed_up", {"service": "holy"}), 0)
        self.assertEqual(await self.redis.xlen("coverage-holy"), 0)
