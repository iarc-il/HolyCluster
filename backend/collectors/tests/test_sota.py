import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2]))

from collectors.sota import (  # noqa: E402
    clean_sota_callsign,
    get_sota_reference,
    get_sota_spot_key,
    parse_sota_frequency,
    parse_sota_points,
    parse_sota_spot,
)
from collectors.utils import build_spot_key  # noqa: E402


def test_clean_sota_callsign_uppercases_and_preserves_portable_suffixes():
    assert clean_sota_callsign(" dk5mer/p ") == "DK5MER/P"


def test_parse_sota_frequency_converts_mhz_to_khz():
    assert parse_sota_frequency("14.328") == 14328.0
    assert parse_sota_frequency("144.300") == 144300.0
    assert parse_sota_frequency("1296.200") == 1296200.0


def test_parse_sota_points_from_summit_details():
    assert parse_sota_points("Wasserkuppe, 950m, 10 points") == 10
    assert parse_sota_points("Example Summit, 450m, 1 point") == 1
    assert parse_sota_points("Example Summit") is None


def test_parse_sota_spot_maps_to_collector_spot():
    raw_spot = {
        "id": 323137,
        "userID": 106500,
        "timeStamp": "2026-06-05T08:11:00",
        "comments": "CQ SOTA",
        "callsign": "DM5TO",
        "associationCode": "DM",
        "summitCode": "HE-001",
        "activatorCallsign": "DK5MER/P",
        "activatorName": "Martin",
        "frequency": "14.328",
        "mode": "SSB",
        "summitDetails": "Wasserkuppe, 950m, 10 points",
        "highlightColor": None,
    }

    spot = parse_sota_spot(raw_spot)

    assert spot["cluster"] == "sota"
    assert spot["type"] == "sota"
    assert spot["spotter_callsign"] == "DM5TO"
    assert spot["dx_callsign"] == "DK5MER/P"
    assert spot["frequency"] == 14328.0
    assert spot["mode"] == "SSB"
    assert spot["time"] == "0811Z"
    assert spot["timestamp"] == int(datetime(2026, 6, 5, 8, 11, tzinfo=timezone.utc).timestamp())
    assert spot["comment"] == "CQ SOTA"
    assert spot["pota_reference"] == "DM/HE-001"
    assert spot["pota_name"] == "Wasserkuppe, 950m, 10 points"
    assert spot["pota_description"] == "SOTA"
    assert spot["sota_points"] == 10
    assert get_sota_reference(raw_spot) == "DM/HE-001"
    assert get_sota_spot_key(raw_spot) == "sota:323137"
    assert build_spot_key(spot) == "0811Z:DK5MER/P:14328.0:DM5TO"
