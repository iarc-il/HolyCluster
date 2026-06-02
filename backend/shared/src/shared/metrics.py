import json
import time

import redis.asyncio

PREFIX = "monitor"


async def set_timestamp(valkey: redis.asyncio.Redis, key: str):
    await valkey.set(f"{PREFIX}:{key}", str(time.time()))


async def incr_counter(valkey: redis.asyncio.Redis, key: str):
    await valkey.incr(f"{PREFIX}:{key}")


async def set_value(valkey: redis.asyncio.Redis, key: str, value):
    await valkey.set(f"{PREFIX}:{key}", str(value))


async def push_drop_event(valkey: redis.asyncio.Redis, reason: str, raw_spot: str):
    event = json.dumps({"reason": reason, "raw_spot": raw_spot, "time": time.time()})
    await valkey.rpush(f"{PREFIX}:collector:drop_events", event)
    await valkey.ltrim(f"{PREFIX}:collector:drop_events", -1000, -1)


async def push_exception_event(valkey: redis.asyncio.Redis, service: str, error: str):
    event = json.dumps({"error": error, "service": service, "time": time.time()})
    await valkey.rpush(f"{PREFIX}:exception_events", event)
    await valkey.ltrim(f"{PREFIX}:exception_events", -1000, -1)


async def push_country_mismatch_event(
    valkey: redis.asyncio.Redis,
    callsign: str,
    callsign_type: str,
    cty_country: tuple[str, str] | None,
    prefix_list_country: tuple[str, str] | None,
):
    def serialize_country(country: tuple[str, str] | None):
        if country is None:
            return None
        return {"country": country[0], "continent": country[1]}

    event = json.dumps(
        {
            "callsign": callsign,
            "callsign_type": callsign_type,
            "cty": serialize_country(cty_country),
            "prefix_list": serialize_country(prefix_list_country),
            "time": time.time(),
        }
    )
    await valkey.rpush(f"{PREFIX}:collector:country_mismatch_events", event)
    await valkey.ltrim(f"{PREFIX}:collector:country_mismatch_events", -1000, -1)
