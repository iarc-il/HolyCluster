import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[3]))

from collectors.enrichers.frequencies import InvalidBandError, find_band_and_mode


def test_find_band_and_mode(debug: bool = False):
    # test for 7100.0
    test_frequency = "7100.0"
    result = find_band_and_mode(test_frequency, "")
    expected = ("40", "SSB", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # RTTY should not be inferred from frequency-only data ranges.
    test_frequency = "14100.0"
    result = find_band_and_mode(test_frequency, "")
    expected = ("20", "SSB", "default")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    result = find_band_and_mode(test_frequency, "RTTY")
    expected = ("20", "RTTY", "comment")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 7350.0
    test_frequency = "7350.0"
    with pytest.raises(InvalidBandError):
        find_band_and_mode(test_frequency, "")

    # test for 21075.0
    test_frequency = "21075.0"
    result = find_band_and_mode(test_frequency, "")
    expected = ("15", "FT8", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 21075.0
    test_frequency = "21075.0"
    result = find_band_and_mode(test_frequency, "FT8")
    expected = ("15", "FT8", "comment")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 21075.0
    test_frequency = "21075.0"
    result = find_band_and_mode(test_frequency, "")
    expected = ("15", "FT8", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 7048.0
    test_frequency = "7048.0"
    result = find_band_and_mode(test_frequency, "")
    expected = ("40", "FT4", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"


if __name__ == "__main__":
    debug = True
    test_find_band_and_mode(debug=debug)
