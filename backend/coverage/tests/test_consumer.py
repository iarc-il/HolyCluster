import unittest
from unittest.mock import AsyncMock

import fakeredis.aioredis
from prometheus_client import CollectorRegistry

from coverage_comparator.consumer import HolyConsumer
from coverage_comparator.matcher import Matcher
from coverage_comparator.metrics import Metrics
from coverage_comparator.samples import MemorySampleSink

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

    async def test_stale_holy_record_is_not_compared(self):
        await self.redis.xadd("coverage-holy", SPOT, id="1-0")
        records = await self.redis.xreadgroup(self.consumer.group, "comparator", {"coverage-holy": ">"})
        self.consumer.clock = lambda: 1000
        await self.consumer.process(records)
        self.assertEqual(self.registry.get_sample_value("holycluster_coverage_feed_up", {"service": "holy"}), 0)
        self.assertEqual(await self.redis.xlen("coverage-holy"), 0)
