import asyncio
import hashlib
import time
import uuid

import redis.exceptions
from loguru import logger
from shared.telemetry import capture_exception

from collectors.metrics import CollectorMetrics, metrics

FINALIZATION_KEY = "collector:telnet_spot_finalization"
SOURCES_KEY_PREFIX = "collector:telnet_spot_sources:"
FINALIZATION_BATCH_SIZE = 1000
FINALIZATION_POLL_INTERVAL_SECONDS = 5

RECORD_SPOT_SCRIPT = """
local window_id = redis.call('GET', KEYS[1])
if not window_id then
    window_id = ARGV[4]
    redis.call('SET', KEYS[1], window_id, 'EX', ARGV[2])
    redis.call('ZADD', KEYS[2], ARGV[3], window_id)
end
redis.call('SADD', ARGV[5] .. window_id, ARGV[1])
return window_id
"""

FINALIZE_SPOT_SCRIPT = """
local deadline = redis.call('ZSCORE', KEYS[2], ARGV[1])
if not deadline or tonumber(deadline) > tonumber(ARGV[2]) then
    return {}
end
local sources = redis.call('SMEMBERS', KEYS[3])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('DEL', KEYS[3])
if redis.call('GET', KEYS[1]) == ARGV[1] then
    redis.call('DEL', KEYS[1])
end
return sources
"""


class TelnetSpotTracker:
    def __init__(
        self,
        valkey_client,
        *,
        collector_metrics: CollectorMetrics = metrics,
        window_seconds: int = 60,
        clock=time.time,
    ):
        self.valkey_client = valkey_client
        self.metrics = collector_metrics
        self.window_seconds = window_seconds
        self.clock = clock

    @staticmethod
    def _digest(spot_key: str) -> str:
        return hashlib.sha256(spot_key.encode()).hexdigest()

    @staticmethod
    def _window_key(digest: str) -> str:
        return f"collector:telnet_spot_window:{digest}"

    @staticmethod
    def _sources_key(window_id: str) -> str:
        return SOURCES_KEY_PREFIX + window_id

    async def record(self, spot_key: str, source: str):
        digest = self._digest(spot_key)
        deadline = self.clock() + self.window_seconds
        window_id = f"{digest}:{uuid.uuid4().hex}"
        await self.valkey_client.eval(
            RECORD_SPOT_SCRIPT,
            2,
            self._window_key(digest),
            FINALIZATION_KEY,
            source,
            self.window_seconds,
            deadline,
            window_id,
            SOURCES_KEY_PREFIX,
        )

    async def finalize_due(self) -> int:
        now = self.clock()
        window_ids = await self.valkey_client.zrangebyscore(
            FINALIZATION_KEY,
            "-inf",
            now,
            start=0,
            num=FINALIZATION_BATCH_SIZE,
        )
        finalized = 0
        for window_id in window_ids:
            digest = window_id.split(":", 1)[0]
            sources = await self.valkey_client.eval(
                FINALIZE_SPOT_SCRIPT,
                3,
                self._window_key(digest),
                FINALIZATION_KEY,
                self._sources_key(window_id),
                window_id,
                now,
            )
            if not sources:
                continue
            self.metrics.observe_telnet_spot_sources(sources)
            finalized += 1
        return finalized

    async def run(self):
        while True:
            try:
                finalized = await self.finalize_due()
                if finalized == FINALIZATION_BATCH_SIZE:
                    continue
                await asyncio.sleep(FINALIZATION_POLL_INTERVAL_SECONDS)
            except asyncio.CancelledError:
                raise
            except redis.exceptions.RedisError as e:
                logger.warning(f"Failed to finalize Telnet spot source counts: {type(e).__name__}")
                await asyncio.sleep(FINALIZATION_POLL_INTERVAL_SECONDS)
            except Exception as e:
                logger.exception("Unexpected failure finalizing Telnet spot source counts")
                capture_exception(e, operation="collector.telnet_spot_finalization")
                await asyncio.sleep(FINALIZATION_POLL_INTERVAL_SECONDS)
