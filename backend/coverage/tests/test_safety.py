import asyncio
import unittest
from unittest.mock import AsyncMock

import fakeredis.aioredis
from prometheus_client import CollectorRegistry
from pydantic import ValidationError

from coverage_comparator.adapters import FakeAdapter, Snapshot
from coverage_comparator.matcher import Matcher
from coverage_comparator.metrics import Metrics
from coverage_comparator.samples import MemorySampleSink
from coverage_comparator.service import consume_snapshot, run_adapter
from coverage_comparator.settings import Settings

SPOT = {"time": "1200", "dx_callsign": "4X1AA", "frequency": "14074", "spotter_callsign": "W1AA"}


class SafetyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
        self.registry = CollectorRegistry()
        self.sink = MemorySampleSink()
        self.matcher = Matcher(self.redis, Metrics(self.registry), self.sink)
        for source in ("holy", "dxsummit"):
            await self.matcher.health(source, True, 0)
            await self.matcher.health(source, True, 60)

    async def asyncTearDown(self):
        await self.redis.aclose()

    async def test_incomplete_snapshots_skip_instead_of_mismatch(self):
        for snapshot, reason in (
            (Snapshot([], saturated=True), "saturated"),
            (Snapshot([], recoverable=False), "unrecoverable"),
        ):
            with self.subTest(reason=reason):
                await self.matcher.observe("holy", SPOT, 60)
                await consume_snapshot(self.matcher, "dxsummit", snapshot, 61)
                await self.matcher.finalize(120)
                self.assertEqual(
                    self.registry.get_sample_value(
                        "holycluster_coverage_outcomes_total", {"service": "dxsummit", "result": "holy_only"}
                    ),
                    0,
                )
                self.assertEqual(
                    self.registry.get_sample_value(
                        "holycluster_coverage_skipped_total", {"service": "dxsummit", "reason": reason}
                    ),
                    1,
                )
                await self.redis.flushall()
                await self.asyncSetUp()

    async def test_sample_retry_is_durable_and_idempotent(self):
        await self.matcher.observe("holy", SPOT, 60)
        self.sink.put = AsyncMock(side_effect=RuntimeError("database unavailable"))
        with self.assertRaises(RuntimeError):
            await self.matcher.finalize(120)
        recovered_sink = MemorySampleSink()
        recovered = Matcher(self.redis, self.matcher.metrics, recovered_sink)
        await recovered.finalize(121)
        await recovered.finalize(122)
        self.assertEqual(len(recovered_sink.samples), 1)
        self.assertEqual(
            self.registry.get_sample_value(
                "holycluster_coverage_outcomes_total", {"service": "dxsummit", "result": "holy_only"}
            ),
            1,
        )

    async def test_snapshot_parse_error_invalidates_all_observations(self):
        await self.matcher.observe("holy", SPOT, 60)
        await consume_snapshot(self.matcher, "dxsummit", Snapshot([SPOT, {"time": "bad"}]), 61)
        await self.matcher.finalize(120)
        self.assertEqual(
            self.registry.get_sample_value("holycluster_coverage_parse_errors_total", {"service": "dxsummit"}), 1
        )
        self.assertEqual(
            self.registry.get_sample_value(
                "holycluster_coverage_outcomes_total", {"service": "dxsummit", "result": "matched"}
            ),
            0,
        )

    async def test_adapter_cancellation_closes_resources(self):
        adapter = FakeAdapter("dxsummit", [])
        adapter.poll = AsyncMock(side_effect=asyncio.CancelledError())
        adapter.close = AsyncMock()
        with self.assertRaises(asyncio.CancelledError):
            await run_adapter(self.matcher, adapter)
        adapter.close.assert_awaited_once()

    async def test_many_windows_recover_and_finalize_in_bounded_batches(self):
        for number in range(105):
            await self.matcher.observe("holy", {**SPOT, "dx_callsign": f"X{number}"}, 60)
        self.assertEqual(await self.redis.hlen("coverage:windows"), 105)
        recovered = Matcher(self.redis, self.matcher.metrics, self.sink)
        await recovered.finalize(120)
        self.assertEqual(await self.redis.hlen("coverage:windows"), 5)
        await recovered.finalize(120)
        self.assertEqual(await self.redis.hlen("coverage:windows"), 0)
        self.assertEqual(
            self.registry.get_sample_value(
                "holycluster_coverage_outcomes_total", {"service": "dxsummit", "result": "holy_only"}
            ),
            105,
        )

    async def test_disabled_services_emit_no_classifications_or_skips(self):
        matcher = Matcher(self.redis, self.matcher.metrics, self.sink, services=("dxsummit",))
        await matcher.observe("holy", SPOT, 60)
        await matcher.finalize(120)
        self.assertEqual(
            self.registry.get_sample_value(
                "holycluster_coverage_outcomes_total", {"service": "dxsummit", "result": "holy_only"}
            ),
            1,
        )
        self.assertEqual(
            self.registry.get_sample_value(
                "holycluster_coverage_skipped_total", {"service": "dxheat", "reason": "feed_down"}
            ),
            0,
        )

    async def test_pending_sample_limit_does_not_change_classification(self):
        matcher = Matcher(self.redis, self.matcher.metrics, self.sink, max_samples=0)
        await matcher.observe("holy", SPOT, 60)
        await matcher.finalize(120)
        self.assertEqual(len(self.sink.samples), 0)
        self.assertEqual(
            self.registry.get_sample_value(
                "holycluster_coverage_outcomes_total", {"service": "dxsummit", "result": "holy_only"}
            ),
            1,
        )


class SettingsTests(unittest.TestCase):
    def test_window_and_service_names_are_fixed(self):
        required = {
            "postgres_user": "test",
            "postgres_password": "test",
            "postgres_host": "localhost",
            "postgres_port": "5432",
            "postgres_host_local": "localhost",
            "postgres_port_local": "5432",
            "valkey_host": "localhost",
            "valkey_port": 6379,
            "valkey_host_local": "localhost",
            "valkey_port_local": 6379,
            "sentry_environment": "dev",
            "sentry_release": "test",
        }
        settings = Settings(_env_file=None, **required)
        self.assertEqual(settings.coverage_identity_window_seconds, 60)
        for invalid in (
            {"coverage_identity_window_seconds": 61},
            {"coverage_services": ("unknown",)},
            {"coverage_services": ("dxheat", "dxheat")},
            {"coverage_metrics_port": 0},
        ):
            with self.assertRaises(ValidationError):
                Settings(_env_file=None, **required, **invalid)
