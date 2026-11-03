import pytest

from shared.spot_identity import build_spot_key


@pytest.mark.parametrize(
    ("time", "dx", "frequency", "spotter", "expected"),
    [
        ("0811Z", "DK5MER/P", 14328.0, "DM5TO", "0811Z:DK5MER/P:14328.0:DM5TO"),
        ("0000Z", " dx/p ", "07006.00", "Spotter", "0000Z: dx/p :07006.00:Spotter"),
        (None, "DX", 7006, "SPOTTER", "None:DX:7006:SPOTTER"),
    ],
)
def test_spot_key_keeps_exact_original_format(time, dx, frequency, spotter, expected):
    spot = dict(time=time, dx_callsign=dx, frequency=frequency, spotter_callsign=spotter, comment="ignored")
    assert build_spot_key(spot) == expected
    spot["comment"] = "different"
    assert build_spot_key(spot) == expected


def test_spot_key_requires_all_identity_fields():
    with pytest.raises(KeyError):
        build_spot_key({"time": "0811Z"})
