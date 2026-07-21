import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))

from collectors.enrichers.frequencies import find_band, load_band_plans


def test_find_band():
    band_plans_path = Path(__file__).parents[4] / "shared" / "band_plans.json"
    bands, _ = load_band_plans(band_plans_path)

    # Test find_band for each band
    for band, start, end in bands:
        # Pick a frequency in the middle of the band
        test_freq = (start + end) / 2
        result = find_band(str(test_freq))
        assert result == band, f"Expected {band} for {test_freq}, got {result}"
        print(f"Tested {band}: {test_freq} -> {result}")

    # Test out of range
    result = find_band(frequency="1")
    assert result == "", f"Expected '' for 1, got {result}"

    result = find_band(frequency="3000")  # Between 160m (2000) and 80m (3500)
    assert result == "", f"Expected '' for 3000, got {result}"

    result = find_band(frequency="100000000")
    assert result == "", f"Expected '' for 100000000, got {result}"

    print(f"Loaded {len(bands)} bands and tested successfully.")


if __name__ == "__main__":
    test_find_band()
