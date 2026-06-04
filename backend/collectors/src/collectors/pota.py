import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any

import aiohttp
from loguru import logger
from shared.metrics import push_drop_event, push_exception_event, set_value

POTA_CLUSTER = "pota.app"
POTA_TYPE = "pota"
POTA_SPOTS_URL = "https://api.pota.app/v1/spots"
POTA_POLL_INTERVAL = 60
POTA_REQUEST_TIMEOUT = 15
POTA_SPOT_EXPIRATION = 7200
STREAM_ARRIVALS = "stream-arrivals"


def clean_pota_callsign(callsign: object) -> str:
    callsign = str(callsign or "").strip().upper()
    callsign = re.sub(r"(?:-\d+)?-#$", "", callsign)
    callsign = re.sub(r"-\d+$", "", callsign)
    return callsign


def parse_pota_spot_time(value: object) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("missing spotTime")

    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"

    spot_time = datetime.fromisoformat(normalized)
    if spot_time.tzinfo is None:
        return spot_time.replace(tzinfo=timezone.utc)
    return spot_time.astimezone(timezone.utc)


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _build_pota_comment(raw_spot: dict[str, Any]) -> str:
    reference = _as_text(raw_spot.get("reference"))
    name = _as_text(raw_spot.get("name") or raw_spot.get("parkName"))
    comments = _as_text(raw_spot.get("comments"))
    details = " ".join(part for part in ("POTA", reference, name) if part)

    if details and comments:
        return f"{details} | {comments}"
    return details or comments


def parse_pota_spot(raw_spot: dict[str, Any]) -> dict:
    try:
        spot_id = int(raw_spot["spotId"])
        spot_time = parse_pota_spot_time(raw_spot["spotTime"])
        frequency = float(_as_text(raw_spot.get("frequency")))
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError(f"invalid POTA spot: {e}") from e

    spotter_callsign = clean_pota_callsign(raw_spot.get("spotter"))
    dx_callsign = clean_pota_callsign(raw_spot.get("activator"))
    if not spotter_callsign or not dx_callsign:
        raise ValueError("invalid POTA spot: missing spotter or activator")

    return {
        "cluster": POTA_CLUSTER,
        "type": POTA_TYPE,
        "pota_spot_id": spot_id,
        "spotter_callsign": spotter_callsign,
        "frequency": frequency,
        "dx_callsign": dx_callsign,
        "comment": _build_pota_comment(raw_spot),
        "mode": _as_text(raw_spot.get("mode")).upper(),
        "time": spot_time.strftime("%H%MZ"),
        "timestamp": int(spot_time.timestamp()),
        "dx_locator": _as_text(raw_spot.get("grid6") or raw_spot.get("grid4")),
        "spotter_locator": "",
    }


async def fetch_pota_spots(session: aiohttp.ClientSession, url: str) -> list[dict[str, Any]]:
    async with session.get(url) as response:
        response.raise_for_status()
        data = await response.json()

    if not isinstance(data, list):
        raise ValueError(f"POTA spots response is {type(data).__name__}, expected list")
    return data


async def _record_arrival(valkey_client, spot_key: str, added: bool):
    try:
        await valkey_client.xadd(
            STREAM_ARRIVALS,
            {"cluster": POTA_CLUSTER, "spot_key": spot_key, "accepted": "1" if added else "0"},
        )
    except Exception:
        logger.warning("Failed to write POTA arrival to stream-arrivals", exc_info=True)


async def run_pota_collector(output_queue: asyncio.Queue):
    from collectors.db.valkey_config import get_valkey_client

    logger.info("Starting POTA spot collector")
    valkey_client = get_valkey_client()
    timeout = aiohttp.ClientTimeout(total=POTA_REQUEST_TIMEOUT)
    headers = {"User-Agent": "HolyCluster collector (https://holycluster.iarc.org/)"}

    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        while True:
            try:
                raw_spots = await fetch_pota_spots(session, POTA_SPOTS_URL)
                await set_value(valkey_client, "collector:pota:connected", 1)

                queued_count = 0
                for raw_spot in sorted(raw_spots, key=lambda spot: _as_text(spot.get("spotTime"))):
                    try:
                        spot = parse_pota_spot(raw_spot)
                    except ValueError as e:
                        logger.info(f"Dropping POTA spot due to parse error: {e}: {raw_spot}")
                        await push_drop_event(valkey_client, "pota_parse_error", json.dumps(raw_spot, default=str))
                        continue

                    spot_key = f"pota:{spot['pota_spot_id']}"
                    added = await valkey_client.set(spot_key, 1, ex=POTA_SPOT_EXPIRATION, nx=True)
                    await _record_arrival(valkey_client, spot_key, bool(added))
                    if added:
                        await output_queue.put(spot)
                        queued_count += 1

                logger.debug(f"Fetched {len(raw_spots)} POTA spots, queued {queued_count} new spots")
                await asyncio.sleep(POTA_POLL_INTERVAL)
            except asyncio.CancelledError:
                logger.info("POTA collector cancelled")
                break
            except Exception as e:
                logger.exception("POTA collector failed")
                await set_value(valkey_client, "collector:pota:connected", 0)
                await push_exception_event(valkey_client, "collector", f"pota: {e}")
                await asyncio.sleep(min(POTA_POLL_INTERVAL, 300))
