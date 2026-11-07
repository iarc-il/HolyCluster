import asyncio
import json
import time

from loguru import logger
from redis.exceptions import ResponseError
from shared.telemetry import capture_exception

from .adapters import encode_spot
from .matcher import WINDOW, Matcher, stream_id
from .metrics import PIPELINE_RESULTS
from .service import retry_delay

STREAM = "coverage-holy"
PIPELINE_STREAM = "coverage-holy-pipeline"
GROUP = "coverage-comparator"


class PipelineConsumer:
    def __init__(self, redis, matcher: Matcher, *, clock=time.time):
        self.redis = redis
        self.matcher = matcher
        self.clock = clock
        self.group = GROUP
        self.consumer = "pipeline-comparator"

    async def prepare(self):
        try:
            await self.redis.xgroup_create(PIPELINE_STREAM, self.group, id="0-0", mkstream=True)
        except ResponseError as error:
            if "BUSYGROUP" not in str(error):
                raise

    async def process(self, records):
        for _, entries in records:
            for event_id, fields in entries:
                now = self.clock()
                age = now - stream_id(event_id)[0] / 1000
                acknowledge = age > WINDOW
                if 0 <= age <= WINDOW:
                    try:
                        result = fields["result"]
                        spot = json.loads(fields["spot"]) if "spot" in fields else fields
                        if "spot" not in fields:
                            spot = {key: value for key, value in spot.items() if key != "result"}
                        encode_spot(spot, self.matcher.sample_max_bytes)
                        if result not in PIPELINE_RESULTS:
                            raise ValueError("Unknown pipeline result")
                    except (ValueError, TypeError, KeyError):
                        self.matcher.metrics.parse_errors.labels("holy").inc()
                        acknowledge = True
                    else:
                        acknowledge = await self.matcher.observe_pipeline(spot, result, now) != "pending"
                if acknowledge:
                    async with self.redis.pipeline(transaction=True) as pipe:
                        pipe.xack(PIPELINE_STREAM, self.group, event_id)
                        pipe.xdel(PIPELINE_STREAM, event_id)
                        await pipe.execute()

    async def recover(self, min_idle=0):
        cursor = "0-0"
        while True:
            result = await self.redis.xautoclaim(
                PIPELINE_STREAM, self.group, self.consumer, min_idle, cursor, count=100
            )
            cursor, entries = result[:2]
            await self.process([(PIPELINE_STREAM, entries)])
            if cursor == "0-0":
                return

    async def run(self):
        failures = 0
        while True:
            try:
                await self.prepare()
                await self.recover()
                while True:
                    records = await self.redis.xreadgroup(
                        self.group,
                        self.consumer,
                        {PIPELINE_STREAM: ">"},
                        count=100,
                        block=1000,
                    )
                    await self.process(records)
                    await self.recover(min_idle=1000)
                    failures = 0
                    await asyncio.sleep(0)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                failures += 1
                self.matcher.metrics.reconnects.labels("holy").inc()
                logger.warning("Holy pipeline coverage stream failed: {}", type(error).__name__)
                capture_exception(error, operation="coverage.holy_pipeline")
                await asyncio.sleep(retry_delay(failures))


class HolyConsumer:
    def __init__(self, redis, matcher: Matcher, *, clock=time.time, max_stream_length=10000):
        self.redis = redis
        self.matcher = matcher
        self.clock = clock
        self.max_stream_length = max_stream_length
        self.group = GROUP
        self.consumer = "comparator"

    async def prepare(self):
        try:
            await self.redis.xgroup_create(STREAM, self.group, id="0-0", mkstream=True)
        except ResponseError as error:
            if "BUSYGROUP" not in str(error):
                raise

    async def process(self, records):
        saturated = await self.redis.xlen(STREAM) >= self.max_stream_length
        if saturated:
            await self.matcher.health("holy", False, self.clock(), saturated=True)
        for _, entries in records:
            for event_id, fields in entries:
                now = self.clock()
                age = now - stream_id(event_id)[0] / 1000
                tail = await self.redis.xrevrange(STREAM, count=1)
                caught_up = bool(tail and tail[0][0] == event_id)
                if age < 0 or age > self.matcher.stale_after:
                    await self.matcher.health("holy", False, now)
                else:
                    if caught_up and not saturated:
                        await self.matcher.health("holy", True, now)
                    try:
                        spot = json.loads(fields["spot"]) if "spot" in fields else fields
                        encode_spot(spot, self.matcher.sample_max_bytes)
                    except (ValueError, TypeError, KeyError):
                        self.matcher.metrics.parse_errors.labels("holy").inc()
                        await self.matcher.health("holy", False, now)
                    else:
                        await self.matcher.observe("holy", spot, now, event_id=event_id)
                async with self.redis.pipeline(transaction=True) as pipe:
                    pipe.xack(STREAM, self.group, event_id)
                    pipe.xdel(STREAM, event_id)
                    await pipe.execute()

    async def recover(self):
        await self.matcher.health("holy", False, self.clock())
        cursor = "0-0"
        while True:
            result = await self.redis.xautoclaim(STREAM, self.group, self.consumer, 0, cursor, count=100)
            cursor, entries = result[:2]
            if len(result) > 2 and result[2]:
                await self.matcher.health("holy", False, self.clock(), recoverable=False)
            await self.process([(STREAM, entries)])
            if cursor == "0-0":
                return

    async def run(self):
        failures = 0
        while True:
            try:
                await self.prepare()
                await self.recover()
                while True:
                    records = await self.redis.xreadgroup(
                        self.group,
                        self.consumer,
                        {STREAM: ">"},
                        count=100,
                        block=1000,
                    )
                    await self.process(records)
                    failures = 0
                    await asyncio.sleep(0)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                failures += 1
                self.matcher.metrics.reconnects.labels("holy").inc()
                logger.warning("Holy coverage stream failed: {}", type(error).__name__)
                capture_exception(error, operation="coverage.holy")
                try:
                    await self.matcher.health("holy", False, self.clock())
                except Exception:
                    logger.warning("Cannot save Holy feed health")
                await asyncio.sleep(retry_delay(failures))
