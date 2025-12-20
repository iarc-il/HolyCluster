import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))

from collectors.src.enrichers.frequencies import find_band_and_mode


def test_find_band_and_mode(debug: bool = False):
    # test for 7100.0
    test_frequency = "7100.0"
    result = find_band_and_mode(test_frequency, "", debug)
    expected = ("40", "SSB", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 14100.0
    test_frequency = "14100.0"
    result = find_band_and_mode(test_frequency, "", debug)
    expected = ("20", "RTTY", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 7350.0
    test_frequency = "7350.0"
    result = find_band_and_mode(test_frequency, "", debug)
    expected = None
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 21075.0
    test_frequency = "21075.0"
    result = find_band_and_mode(test_frequency, "", debug)
    expected = ("15", "FT8", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 21075.0
    test_frequency = "21075.0"
    result = find_band_and_mode(test_frequency, "FT8", debug)
    expected = ("15", "FT8", "comment")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 21075.0
    test_frequency = "21075.0"
    result = find_band_and_mode(test_frequency, "", debug)
    expected = ("15", "FT8", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"

    # test for 7048.0
    test_frequency = "7048.0"
    result = find_band_and_mode(test_frequency, "", debug)
    expected = ("40", "FT4", "range")
    assert result == expected, f"Expected {expected} for {test_frequency}, got {result}"


if __name__ == "__main__":
    debug = True
    test_find_band_and_mode(debug=debug)
