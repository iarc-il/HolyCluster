import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2]))

from collectors.wwff import clean_wwff_callsign, get_wwff_spot_key, parse_wwff_spot
from collectors.utils import build_spot_key


def test_clean_wwff_callsign_uppercases_and_preserves_portable_prefixes():
    assert clean_wwff_callsign(" om/sq9mdf/p ") == "OM/SQ9MDF/P"


def test_parse_wwff_spot_maps_to_collector_spot():
    raw_spot = {
        "id": 105959,
        "activator": "F4ILK/P",
        "frequency_khz": 7006,
        "mode": "CW",
        "reference": "FFF-3970",
        "reference_name": "CAVITES SOUTERRAINES LE BUISSON",
        "remarks": "Auto-spotted via RBN",
        "spotter": "ES2RR",
        "latitude": 47.34997,
        "longitude": -0.33348,
        "spot_time": 1780645939,
        "spot_time_formatted": "2026-06-05 07:52:19",
    }

    spot = parse_wwff_spot(raw_spot)

    assert spot["cluster"] == "spots.wwff.co"
    assert spot["type"] == "wwff"
    assert spot["spotter_callsign"] == "ES2RR"
    assert spot["dx_callsign"] == "F4ILK/P"
    assert spot["frequency"] == 7006.0
    assert spot["mode"] == "CW"
    assert spot["time"] == "0752Z"
    assert spot["timestamp"] == int(datetime(2026, 6, 5, 7, 52, 19, tzinfo=timezone.utc).timestamp())
    assert spot["comment"] == "Auto-spotted via RBN"
    assert spot["pota_reference"] == "FFF-3970"
    assert spot["pota_name"] == "CAVITES SOUTERRAINES LE BUISSON"
    assert spot["pota_description"] == "WWFF"
    assert get_wwff_spot_key(raw_spot) == "wwff:105959"
    assert build_spot_key(spot) == "0752Z:F4ILK/P:7006.0:ES2RR"
