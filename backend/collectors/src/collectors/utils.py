import asyncio
import random
from collections.abc import Callable
from typing import Any

import aiohttp
from loguru import logger
from shared.telemetry import capture_exception

USER_AGENT = "HolyCluster collector (https://holycluster.iarc.org/)"
MAX_RETRY_DELAY_SECONDS = 300


class UpstreamResponseError(Exception):
    pass


def retry_delay(poll_interval: int, failure_count: int) -> float:
    exponent = min(failure_count - 1, 10)
    base_delay = min(poll_interval * 2**exponent, MAX_RETRY_DELAY_SECONDS)
    return min(base_delay + random.uniform(0, base_delay * 0.2), MAX_RETRY_DELAY_SECONDS)


def as_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def build_spot_key(spot: dict[str, Any]) -> str:
    return f"{spot['time']}:{spot['dx_callsign']}:{spot['frequency']}:{spot['spotter_callsign']}"


async def fetch_json_list(session: aiohttp.ClientSession, url: str, source_label: str) -> list[dict[str, Any]]:
    async with session.get(url) as response:
        response.raise_for_status()
        data = await response.json()

    if not isinstance(data, list):
        raise UpstreamResponseError(f"{source_label} spots response is {type(data).__name__}, expected list")
    return data


async def run_json_spot_collector(
    output_queue: asyncio.Queue,
    *,
    source_label: str,
    metric_name: str,
    url: str,
    poll_interval: int,
    request_timeout: int,
    spot_expiration: int,
    get_spot_key: Callable[[dict[str, Any]], str],
    parse_spot: Callable[[dict[str, Any]], dict],
    sort_key: Callable[[dict[str, Any]], object],
):
    from collectors.db.valkey_config import get_valkey_client
    from collectors.settings import settings

    logger.info(f"Starting {source_label} spot collector")
    valkey_client = get_valkey_client()
    timeout = aiohttp.ClientTimeout(total=request_timeout)
    headers = {"User-Agent": USER_AGENT}
    failure_count = 0
    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        while True:
            try:
                raw_spots = await fetch_json_list(session, url, source_label)
                valid_raw_spots = [spot for spot in raw_spots if isinstance(spot, dict)]
                invalid_count = len(raw_spots) - len(valid_raw_spots)
                if invalid_count:
                    logger.info(f"Dropping {invalid_count} malformed {source_label} spot records")

                queued_count = 0
                for raw_spot in sorted(valid_raw_spots, key=sort_key):
                    try:
                        source_spot_key = get_spot_key(raw_spot)
                        spot = parse_spot(raw_spot)
                        content_spot_key = build_spot_key(spot)
                    except (KeyError, TypeError, ValueError) as e:
                        logger.info(f"Dropping {source_label} spot due to parse error: {e}")
                        continue

                    source_added = await valkey_client.set(source_spot_key, 1, ex=spot_expiration, nx=True)
                    if not source_added:
                        continue

                    content_added = await valkey_client.set(
                        content_spot_key, 1, ex=settings.valkey_spot_expiration, nx=True
                    )
                    if content_added:
                        await output_queue.put(spot)
                        queued_count += 1

                logger.debug(f"Fetched {len(raw_spots)} {source_label} spots, queued {queued_count} new spots")
                failure_count = 0
                await asyncio.sleep(poll_interval)
            except asyncio.CancelledError:
                logger.info(f"{source_label} collector cancelled")
                break
            except UpstreamResponseError as e:
                failure_count += 1
                delay = retry_delay(poll_interval, failure_count)
                logger.warning(f"{source_label} upstream response unavailable; retrying in {delay:.1f}s: {e}")
                await asyncio.sleep(delay)
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                failure_count += 1
                delay = retry_delay(poll_interval, failure_count)
                logger.warning(
                    f"{source_label} endpoint unavailable; retrying in {delay:.1f}s: {type(e).__name__}"
                )
                capture_exception(e, operation=f"collector.poll.{metric_name}")
                await asyncio.sleep(delay)
            except Exception as e:
                failure_count += 1
                logger.exception(f"{source_label} collector failed")
                capture_exception(e, operation=f"collector.poll.{metric_name}")
                await asyncio.sleep(retry_delay(poll_interval, failure_count))
