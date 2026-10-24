import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import redis.exceptions
from prometheus_client import REGISTRY

from api.main import app, spots_broadcast_task


def run_count(outcome):
    return (
        REGISTRY.get_sample_value(
            "holycluster_api_background_runs_total", {"task": "spot_broadcast", "outcome": outcome}
        )
        or 0
    )


class BroadcastMetricsTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.client = MagicMock()
        self.client.xgroup_create = AsyncMock()
        self.client.xreadgroup = AsyncMock()
        self.client.xack = AsyncMock()
        self.client.xdel = AsyncMock()
        self.client.aclose = AsyncMock()

    async def run_until_retry(self):
        with (
            patch("api.main.redis.asyncio.Redis", return_value=self.client),
            patch("api.main.asyncio.sleep", new=AsyncMock(side_effect=asyncio.CancelledError)),
        ):
            with self.assertRaises(asyncio.CancelledError):
                await spots_broadcast_task(app)
        self.client.aclose.assert_awaited_once()

    async def test_initialization_failures_count_each_attempt_once(self):
        for error in (redis.exceptions.ResponseError("group failure"), redis.exceptions.ConnectionError("offline")):
            with self.subTest(error=type(error).__name__):
                self.client.aclose.reset_mock()
                self.client.xgroup_create.side_effect = error
                before = run_count("error")
                await self.run_until_retry()
                self.assertEqual(run_count("error"), before + 1)
                self.client.xreadgroup.assert_not_awaited()

    async def test_repeated_initialization_and_read_failures_count_each_attempt(self):
        self.client.xgroup_create.side_effect = [
            redis.exceptions.ConnectionError("offline"),
            redis.exceptions.ConnectionError("offline"),
            None,
        ]
        self.client.xreadgroup.side_effect = [
            redis.exceptions.ConnectionError("offline"),
            redis.exceptions.ConnectionError("offline"),
            asyncio.CancelledError(),
        ]
        before = run_count("error")
        with (
            patch("api.main.redis.asyncio.Redis", return_value=self.client),
            patch("api.main.asyncio.sleep", new=AsyncMock()),
        ):
            with self.assertRaises(asyncio.CancelledError):
                await spots_broadcast_task(app)
        self.assertEqual(run_count("error"), before + 4)
        self.client.aclose.assert_awaited_once()

    async def test_successful_batch_updates_success_metrics(self):
        self.client.xreadgroup.side_effect = [[("stream-api", [("1-0", {})])], asyncio.CancelledError()]
        before = run_count("success")
        errors = run_count("error")
        with patch("api.main.cleanup_spot", return_value=None):
            await self.run_until_retry()
        self.assertEqual(run_count("success"), before + 1)
        self.assertEqual(run_count("error"), errors)
        self.assertGreater(
            REGISTRY.get_sample_value(
                "holycluster_api_background_last_success_timestamp_seconds", {"task": "spot_broadcast"}
            ),
            0,
        )

    async def test_read_failure_counts_once_without_advancing_last_success(self):
        self.client.xreadgroup.side_effect = redis.exceptions.ConnectionError("offline")
        before = run_count("error")
        success = REGISTRY.get_sample_value(
            "holycluster_api_background_last_success_timestamp_seconds", {"task": "spot_broadcast"}
        )
        await self.run_until_retry()
        self.assertEqual(run_count("error"), before + 1)
        self.assertEqual(
            REGISTRY.get_sample_value(
                "holycluster_api_background_last_success_timestamp_seconds", {"task": "spot_broadcast"}
            ),
            success,
        )

    async def test_processing_failure_is_not_counted_twice(self):
        self.client.xreadgroup.return_value = [("stream-api", [("1-0", {})])]
        self.client.xack.side_effect = redis.exceptions.ConnectionError("offline")
        before = run_count("error")
        with patch("api.main.cleanup_spot", return_value=None):
            await self.run_until_retry()
        self.assertEqual(run_count("error"), before + 1)

    async def test_idle_reads_busygroup_and_cancellation_are_not_errors(self):
        self.client.xgroup_create.side_effect = redis.exceptions.ResponseError("BUSYGROUP group exists")
        self.client.xreadgroup.side_effect = [[], [("stream-api", [])], asyncio.CancelledError()]
        errors = run_count("error")
        successes = run_count("success")
        await self.run_until_retry()
        self.assertEqual(run_count("error"), errors)
        self.assertEqual(run_count("success"), successes)

    async def test_cancelled_initialization_is_not_an_error(self):
        self.client.xgroup_create.side_effect = asyncio.CancelledError()
        before = run_count("error")
        await self.run_until_retry()
        self.assertEqual(run_count("error"), before)
