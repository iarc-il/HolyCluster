import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2]))

from collectors.pota import clean_pota_callsign, get_pota_spot_key, parse_pota_spot
from collectors.utils import build_spot_key


def test_clean_pota_callsign_removes_rbn_suffixes():
    assert clean_pota_callsign("KM3T-3-#") == "KM3T"
    assert clean_pota_callsign("K1RA-#") == "K1RA"
    assert clean_pota_callsign("VE6AO-7") == "VE6AO"


def test_parse_pota_spot_maps_to_collector_spot():
    raw_spot = {
        "spotId": 51365407,
        "activator": "KQ4PEP",
        "frequency": "14074.0",
        "mode": "FT8",
        "reference": "US-2939",
        "spotTime": "2026-06-04T20:50:15",
        "spotter": "W1NT-6-#",
        "comments": "RBN 1 dB via W1NT-6-#",
        "name": "Cumberland Mountain State Park",
        "locationDesc": "US-TN",
        "grid4": "EM75",
        "grid6": "EM75mv",
    }

    spot = parse_pota_spot(raw_spot)

    assert spot["cluster"] == "pota.app"
    assert spot["type"] == "pota"
    assert spot["spotter_callsign"] == "W1NT"
    assert spot["dx_callsign"] == "KQ4PEP"
    assert spot["frequency"] == 14074.0
    assert spot["mode"] == "FT8"
    assert spot["time"] == "2050Z"
    assert spot["timestamp"] == int(datetime(2026, 6, 4, 20, 50, 15, tzinfo=timezone.utc).timestamp())
    assert spot["dx_locator"] == "EM75mv"
    assert spot["comment"] == ""
    assert spot["pota_reference"] == "US-2939"
    assert spot["pota_name"] == "Cumberland Mountain State Park"
    assert spot["pota_description"] == "US-TN"
    assert get_pota_spot_key(raw_spot) == "pota:51365407"
    assert build_spot_key(spot) == "2050Z:KQ4PEP:14074.0:W1NT"
