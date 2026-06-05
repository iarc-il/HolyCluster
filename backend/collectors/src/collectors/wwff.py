import asyncio
from datetime import datetime, timezone
from typing import Any

from collectors.utils import as_text, run_json_spot_collector

WWFF_CLUSTER = "spots.wwff.co"
WWFF_TYPE = "wwff"
WWFF_SPOTS_URL = "https://spots.wwff.co/static/spots.json"
WWFF_POLL_INTERVAL = 30
WWFF_REQUEST_TIMEOUT = 15
WWFF_SPOT_EXPIRATION = 2 * 86400


def clean_wwff_callsign(callsign: object) -> str:
    return str(callsign or "").strip().upper()


def parse_wwff_spot_time(raw_spot: dict[str, Any]) -> datetime:
    value = raw_spot.get("spot_time")
    if value not in (None, ""):
        try:
            return datetime.fromtimestamp(int(float(value)), tz=timezone.utc)
        except (TypeError, ValueError, OSError, OverflowError) as e:
            raise ValueError(f"invalid spot_time: {e}") from e

    formatted = as_text(raw_spot.get("spot_time_formatted"))
    if not formatted:
        raise ValueError("missing spot_time")

    try:
        return datetime.strptime(formatted, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError as e:
        raise ValueError(f"invalid spot_time_formatted: {e}") from e


def get_wwff_spot_key(raw_spot: dict[str, Any]) -> str:
    try:
        return f"wwff:{int(raw_spot['id'])}"
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError(f"invalid WWFF spot ID: {e}") from e


def _spot_sort_key(raw_spot: dict[str, Any]) -> int:
    try:
        return int(float(raw_spot.get("spot_time") or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


def parse_wwff_spot(raw_spot: dict[str, Any]) -> dict:
    try:
        spot_time = parse_wwff_spot_time(raw_spot)
        frequency = float(as_text(raw_spot.get("frequency_khz")))
    except (TypeError, ValueError) as e:
        raise ValueError(f"invalid WWFF spot: {e}") from e

    spotter_callsign = clean_wwff_callsign(raw_spot.get("spotter"))
    dx_callsign = clean_wwff_callsign(raw_spot.get("activator"))
    if not spotter_callsign or not dx_callsign:
        raise ValueError("invalid WWFF spot: missing spotter or activator")

    return {
        "cluster": WWFF_CLUSTER,
        "type": WWFF_TYPE,
        "spotter_callsign": spotter_callsign,
        "frequency": frequency,
        "dx_callsign": dx_callsign,
        "comment": as_text(raw_spot.get("remarks")),
        "mode": as_text(raw_spot.get("mode")).upper(),
        "time": spot_time.strftime("%H%MZ"),
        "timestamp": int(spot_time.timestamp()),
        "dx_locator": "",
        "spotter_locator": "",
        "pota_reference": as_text(raw_spot.get("reference")),
        "pota_name": as_text(raw_spot.get("reference_name")),
        "pota_description": WWFF_TYPE.upper(),
    }


async def run_wwff_collector(output_queue: asyncio.Queue):
    await run_json_spot_collector(
        output_queue,
        source_label="WWFF",
        metric_name=WWFF_TYPE,
        cluster=WWFF_CLUSTER,
        url=WWFF_SPOTS_URL,
        poll_interval=WWFF_POLL_INTERVAL,
        request_timeout=WWFF_REQUEST_TIMEOUT,
        spot_expiration=WWFF_SPOT_EXPIRATION,
        get_spot_key=get_wwff_spot_key,
        parse_spot=parse_wwff_spot,
        sort_key=_spot_sort_key,
    )
