import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from collectors.utils import as_text, run_json_spot_collector

POTA_CLUSTER = "pota.app"
POTA_TYPE = "pota"
POTA_SPOTS_URL = "https://api.pota.app/v1/spots"
POTA_POLL_INTERVAL = 60
POTA_REQUEST_TIMEOUT = 15
POTA_SPOT_EXPIRATION = 7200


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


def get_pota_spot_key(raw_spot: dict[str, Any]) -> str:
    try:
        return f"pota:{int(raw_spot['spotId'])}"
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError(f"invalid POTA spot ID: {e}") from e


def parse_pota_spot(raw_spot: dict[str, Any]) -> dict:
    try:
        spot_time = parse_pota_spot_time(raw_spot["spotTime"])
        frequency = float(as_text(raw_spot.get("frequency")))
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError(f"invalid POTA spot: {e}") from e

    spotter_callsign = clean_pota_callsign(raw_spot.get("spotter"))
    dx_callsign = clean_pota_callsign(raw_spot.get("activator"))
    if not spotter_callsign or not dx_callsign:
        raise ValueError("invalid POTA spot: missing spotter or activator")

    return {
        "cluster": POTA_CLUSTER,
        "type": POTA_TYPE,
        "spotter_callsign": spotter_callsign,
        "frequency": frequency,
        "dx_callsign": dx_callsign,
        "comment": "",
        "mode": as_text(raw_spot.get("mode")).upper(),
        "time": spot_time.strftime("%H%MZ"),
        "timestamp": int(spot_time.timestamp()),
        "dx_locator": as_text(raw_spot.get("grid6") or raw_spot.get("grid4")),
        "spotter_locator": "",
        "pota_reference": as_text(raw_spot.get("reference")),
        "pota_name": as_text(raw_spot.get("name") or raw_spot.get("parkName")),
        "pota_description": as_text(raw_spot.get("locationDesc")),
    }


async def run_pota_collector(output_queue: asyncio.Queue):
    await run_json_spot_collector(
        output_queue,
        source_label="POTA",
        metric_name=POTA_TYPE,
        cluster=POTA_CLUSTER,
        url=POTA_SPOTS_URL,
        poll_interval=POTA_POLL_INTERVAL,
        request_timeout=POTA_REQUEST_TIMEOUT,
        spot_expiration=POTA_SPOT_EXPIRATION,
        get_spot_key=get_pota_spot_key,
        parse_spot=parse_pota_spot,
        sort_key=lambda spot: as_text(spot.get("spotTime")),
    )
