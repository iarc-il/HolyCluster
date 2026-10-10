import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))

from collectors.enrichers.frequencies import load_band_plans


def test_load_band_plans():
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

    print(f"Loaded {len(bands)} bands successfully.")


if __name__ == "__main__":
    test_load_band_plans()
