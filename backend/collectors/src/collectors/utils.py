import asyncio
import json
from collections.abc import Callable
from typing import Any

import aiohttp
from loguru import logger
from shared.metrics import push_drop_event, push_exception_event, set_value

STREAM_ARRIVALS = "stream-arrivals"
USER_AGENT = "HolyCluster collector (https://holycluster.iarc.org/)"


def as_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


async def fetch_json_list(session: aiohttp.ClientSession, url: str, source_label: str) -> list[dict[str, Any]]:
    async with session.get(url) as response:
        response.raise_for_status()
        data = await response.json()

    if not isinstance(data, list):
        raise ValueError(f"{source_label} spots response is {type(data).__name__}, expected list")
    return data


async def record_arrival(valkey_client, cluster: str, source_label: str, spot_key: str, added: bool):
    try:
        await valkey_client.xadd(
            STREAM_ARRIVALS,
            {"cluster": cluster, "spot_key": spot_key, "accepted": "1" if added else "0"},
        )
    except Exception:
        logger.warning(f"Failed to write {source_label} arrival to stream-arrivals", exc_info=True)


async def run_json_spot_collector(
    output_queue: asyncio.Queue,
    *,
    source_label: str,
    metric_name: str,
    cluster: str,
    url: str,
    poll_interval: int,
    request_timeout: int,
    spot_expiration: int,
    get_spot_key: Callable[[dict[str, Any]], str],
    parse_spot: Callable[[dict[str, Any]], dict],
    sort_key: Callable[[dict[str, Any]], object],
):
    from collectors.db.valkey_config import get_valkey_client

    logger.info(f"Starting {source_label} spot collector")
    valkey_client = get_valkey_client()
    timeout = aiohttp.ClientTimeout(total=request_timeout)
    headers = {"User-Agent": USER_AGENT}
    connected_key = f"collector:{metric_name}:connected"

    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        while True:
            try:
                raw_spots = await fetch_json_list(session, url, source_label)
                await set_value(valkey_client, connected_key, 1)

                queued_count = 0
                for raw_spot in sorted(raw_spots, key=sort_key):
                    try:
                        spot_key = get_spot_key(raw_spot)
                        spot = parse_spot(raw_spot)
                    except ValueError as e:
                        logger.info(f"Dropping {source_label} spot due to parse error: {e}: {raw_spot}")
                        await push_drop_event(
                            valkey_client,
                            f"{metric_name}_parse_error",
                            json.dumps(raw_spot, default=str),
                        )
                        continue

                    added = await valkey_client.set(spot_key, 1, ex=spot_expiration, nx=True)
                    await record_arrival(valkey_client, cluster, source_label, spot_key, bool(added))
                    if added:
                        await output_queue.put(spot)
                        queued_count += 1

                logger.debug(f"Fetched {len(raw_spots)} {source_label} spots, queued {queued_count} new spots")
                await asyncio.sleep(poll_interval)
            except asyncio.CancelledError:
                logger.info(f"{source_label} collector cancelled")
                break
            except Exception as e:
                logger.exception(f"{source_label} collector failed")
                await set_value(valkey_client, connected_key, 0)
                await push_exception_event(valkey_client, "collector", f"{metric_name}: {e}")
                await asyncio.sleep(min(poll_interval, 300))
