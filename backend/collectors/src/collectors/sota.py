import asyncio
from datetime import datetime, timezone
from typing import Any

from collectors.utils import as_text, run_json_spot_collector

SOTA_CLUSTER = "sota"
SOTA_SPOTS_URL = "https://api-db2.sota.org.uk/api/spots/100/all"
SOTA_POLL_INTERVAL = 60
SOTA_REQUEST_TIMEOUT = 15
SOTA_SPOT_EXPIRATION = 2 * 86400


def clean_sota_callsign(callsign: object) -> str:
    return str(callsign or "").strip().upper()


def parse_sota_spot_time(value: object) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("missing timeStamp")

    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"

    spot_time = datetime.fromisoformat(normalized)
    if spot_time.tzinfo is None:
        return spot_time.replace(tzinfo=timezone.utc)
    return spot_time.astimezone(timezone.utc)


def parse_sota_frequency(value: object) -> float:
    frequency_mhz = float(as_text(value))
    return frequency_mhz * 1000


def get_sota_spot_key(raw_spot: dict[str, Any]) -> str:
    try:
        return f"sota:{int(raw_spot['id'])}"
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError(f"invalid SOTA spot ID: {e}") from e


def get_sota_reference(raw_spot: dict[str, Any]) -> str:
    association_code = as_text(raw_spot.get("associationCode")).upper()
    summit_code = as_text(raw_spot.get("summitCode")).upper()
    if not association_code or not summit_code:
        return ""
    return f"{association_code}/{summit_code}"


def parse_sota_spot(raw_spot: dict[str, Any]) -> dict:
    try:
        spot_time = parse_sota_spot_time(raw_spot["timeStamp"])
        frequency = parse_sota_frequency(raw_spot.get("frequency"))
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError(f"invalid SOTA spot: {e}") from e

    spotter_callsign = clean_sota_callsign(raw_spot.get("callsign"))
    dx_callsign = clean_sota_callsign(raw_spot.get("activatorCallsign"))
    if not spotter_callsign or not dx_callsign:
        raise ValueError("invalid SOTA spot: missing spotter or activator")

    return {
        "cluster": SOTA_CLUSTER,
        "spotter_callsign": spotter_callsign,
        "frequency": frequency,
        "dx_callsign": dx_callsign,
        "comment": as_text(raw_spot.get("comments")),
        "mode": as_text(raw_spot.get("mode")).upper(),
        "time": spot_time.strftime("%H%MZ"),
        "timestamp": int(spot_time.timestamp()),
        "dx_locator": "",
        "spotter_locator": "",
        "pota_reference": get_sota_reference(raw_spot),
        "pota_name": as_text(raw_spot.get("summitDetails")),
        "pota_description": "SOTA",
    }


async def run_sota_collector(output_queue: asyncio.Queue):
    await run_json_spot_collector(
        output_queue,
        source_label="SOTA",
        metric_name="sota",
        cluster=SOTA_CLUSTER,
        url=SOTA_SPOTS_URL,
        poll_interval=SOTA_POLL_INTERVAL,
        request_timeout=SOTA_REQUEST_TIMEOUT,
        spot_expiration=SOTA_SPOT_EXPIRATION,
        get_spot_key=get_sota_spot_key,
        parse_spot=parse_sota_spot,
        sort_key=lambda spot: as_text(spot.get("timeStamp")),
    )
