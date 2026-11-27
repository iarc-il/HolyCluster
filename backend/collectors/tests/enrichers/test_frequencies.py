from pathlib import Path

import pytest

from collectors.enrichers.frequencies import InvalidBandError, find_band, find_band_and_mode, load_band_plans


def test_find_band():
    band_plans_path = Path(__file__).parents[4] / "shared" / "band_plans.json"
    bands, _ = load_band_plans(band_plans_path)

    # Test find_band for each band
    for band, start, end in bands:
        # Pick a frequency in the middle of the band
        test_freq = (start + end) / 2
        result = find_band(str(test_freq))
        assert result == band, f"Expected {band} for {test_freq}, got {result}"

    # Band boundaries are inclusive (use a band without overlapping neighbors).
    assert find_band("1800") == "160"
    assert find_band("2000") == "160"

    # Test out of range
    result = find_band(frequency="1")
    assert result == "", f"Expected '' for 1, got {result}"

    result = find_band(frequency="3000")  # Between 160m (2000) and 80m (3500)
    assert result == "", f"Expected '' for 3000, got {result}"

    result = find_band(frequency="100000000")
    assert result == "", f"Expected '' for 100000000, got {result}"


def test_find_band_and_mode():
    # test for 7100.0
    test_frequency = "7100.0"
    result = find_band_and_mode(test_frequency, "")
    expected = ("40", "SSB", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # Data ranges should be DIGI, while explicit RTTY still comes from comments only.
    test_frequency = "14100.0"
    result = find_band_and_mode(test_frequency, "")
    expected = ("20", "DIGI", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    result = find_band_and_mode(test_frequency, "RTTY")
    expected = ("20", "RTTY", "comment")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    test_frequency = "14130.0"
    result = find_band_and_mode(test_frequency, "")
    expected = ("20", "SSB", "default")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 7350.0
    test_frequency = "7350.0"
    with pytest.raises(InvalidBandError):
        find_band_and_mode(test_frequency, "")

    # Mode ranges include their lower boundary but exclude their upper boundary.
    assert find_band_and_mode("7074", "") == ("40", "FT8", "range")
    assert find_band_and_mode("7077", "") == ("40", "SSB", "default")

    # test for 21075.0
    test_frequency = "21075.0"
    result = find_band_and_mode(test_frequency, "")
    expected = ("15", "FT8", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    test_frequency = "21120.0"
    result = find_band_and_mode(test_frequency, "")
    expected = ("15", "DIGI", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 21075.0
    test_frequency = "21075.0"
    result = find_band_and_mode(test_frequency, "FT8")
    expected = ("15", "FT8", "comment")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    test_frequency = "7053.0"
    result = find_band_and_mode(test_frequency, "FT2")
    expected = ("40", "DIGI", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 7048.0
    test_frequency = "7048.0"
    result = find_band_and_mode(test_frequency, "")
    expected = ("40", "FT4", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"


def test_load_band_plans_bands():
    file_path = Path(__file__).parents[4] / "shared" / "band_plans.json"
    bands, _ = load_band_plans(file_path)

    # Assert that bands is a list
    assert isinstance(bands, list)

    # Assert that each item is a tuple of (str, number, number)
    for band in bands:
        assert isinstance(band, tuple)
        assert len(band) == 3
        assert isinstance(band[0], str)
        assert isinstance(band[1], (int, float))
        assert isinstance(band[2], (int, float))

    assert bands[0] == ("160", 1800, 2000)


def test_load_band_plans_modes():
    file_path = Path(__file__).parents[4] / "shared" / "band_plans.json"
    _, modes = load_band_plans(file_path)

    assert isinstance(modes, dict)

    assert modes["40"] == {
        "FT8": {"start": 7074, "end": 7077},
        "FT4": {"start": 7047.5, "end": 7050.5},
        "CW": {"start": 7000, "end": 7040},
        "DIGI": {"start": 7040, "end": 7060},
        "SSB": {"start": 7100, "end": 7300},
    }
    assert all("RTTY" not in band_modes for band_modes in modes.values())
    assert all("FT2" not in band_modes for band_modes in modes.values())

    for band_modes in modes.values():
        if "DIGI" not in band_modes:
            continue
        mode_order = list(band_modes)
        digi_index = mode_order.index("DIGI")
        for earlier_mode in ("FT8", "FT4", "CW"):
            if earlier_mode in band_modes:
                assert mode_order.index(earlier_mode) < digi_index
