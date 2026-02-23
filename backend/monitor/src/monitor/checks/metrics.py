import json
import time

import redis.asyncio
from loguru import logger

from monitor.state import CheckState, HealthStatus

PREFIX = "monitor"


async def check_timestamp_key(
    valkey: redis.asyncio.Redis,
    key: str,
    max_age: int,
    state: CheckState,
) -> str | None:
    raw = await valkey.get(f"{PREFIX}:{key}")
    if raw is None:
        return state.update(HealthStatus.UNKNOWN, f"Key {key} not found")

    age = time.time() - float(raw)
    if age > max_age:
        return state.update(HealthStatus.UNHEALTHY, f"{key} is {age:.0f}s old (max {max_age}s)")

    return state.update(HealthStatus.HEALTHY, f"{key} is {age:.0f}s old")


async def check_telnet_connections(
    valkey: redis.asyncio.Redis,
    states: dict[str, CheckState],
) -> list[str]:
    alerts = []
    cursor = "0"
    while True:
        cursor, keys = await valkey.scan(cursor=cursor, match=f"{PREFIX}:collector:telnet:*:connected")
        for key in keys:
            host = key.replace(f"{PREFIX}:collector:telnet:", "").replace(":connected", "")
            if host not in states:
                states[host] = CheckState(f"telnet:{host}")

            value = await valkey.get(key)
            if value == 0:
                alert = states[host].update(HealthStatus.UNHEALTHY, f"Telnet {host} disconnected")
            else:
                alert = states[host].update(HealthStatus.HEALTHY, f"Telnet {host} connected")

            if alert:
                alerts.append(alert)

        if cursor == 0:
            break

    return alerts


async def drain_events(valkey: redis.asyncio.Redis, key: str, max_events: int = 50) -> list[dict]:
    events = []
    for _ in range(max_events):
        raw = await valkey.lpop(key)
        if raw is None:
            break
        try:
            events.append(json.loads(raw))
        except json.JSONDecodeError:
            logger.warning(f"Invalid JSON in {key}: {raw}")
    return events


async def check_metrics(
    valkey: redis.asyncio.Redis,
    heartbeat_timeout: int,
    spot_flow_timeout: int,
    collector_heartbeat_state: CheckState,
    api_heartbeat_state: CheckState,
    spot_flow_state: CheckState,
    telnet_states: dict[str, CheckState],
) -> list[str]:
    alerts = []

    for key, max_age, state in [
        ("collector:heartbeat", heartbeat_timeout, collector_heartbeat_state),
        ("api:heartbeat", heartbeat_timeout, api_heartbeat_state),
        ("collector:last_spot_time", spot_flow_timeout, spot_flow_state),
    ]:
        alert = await check_timestamp_key(valkey, key, max_age, state)
        if alert:
            alerts.append(alert)

    telnet_alerts = await check_telnet_connections(valkey, telnet_states)
    alerts.extend(telnet_alerts)

    exception_events = await drain_events(valkey, f"{PREFIX}:exception_events")
    for event in exception_events:
        alerts.append(f"EXCEPTION in {event.get('service', '?')}: {event.get('error', '?')}")

    drop_events = await drain_events(valkey, f"{PREFIX}:collector:drop_events")
    for event in drop_events:
        alerts.append(f"DROPPED SPOT ({event.get('reason', '?')}): {event.get('raw_spot', '?')}")

    return alerts
