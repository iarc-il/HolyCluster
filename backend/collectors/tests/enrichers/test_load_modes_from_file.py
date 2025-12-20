import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))

from collectors.src.enrichers.frequencies import load_modes_from_file


def test_load_modes_from_file():
    # Path to the modes.json file
    file_path = Path(__file__).parent / "../../src/enrichers/modes.json"
    modes = load_modes_from_file(file_path)
    # print(json.dumps(modes, indent=4))

    # Assert that bands is a list
    assert isinstance(modes, dict)

    # Assert that each item is a tuple of (str, float, float)
    # for band in bands:
    #     assert isinstance(band, tuple)
    #     assert len(band) == 3
    #     assert isinstance(band[0], str)
    #     assert isinstance(band[1], float)
    #     assert isinstance(band[2], float)

    # Assert specific values, e.g., first band
    assert modes["40"] == {
        "CW": {"start": 7000, "end": 7040},
        "RTTY": {"start": 7040, "end": 7100},
        "SSB": {"start": 7100, "end": 7300},
    }

    # Count the number of modes per band
    for band, band_modes in modes.items():
        count = len(band_modes)
        print(f"Band {band}m has {count} mode(s): {', '.join(band_modes.keys())}")

    # Optional summary of all distinct modes
    all_modes = {mode for band_modes in modes.values() for mode in band_modes}
    print(
        f"\nTotal distinct modes across all bands: {len(all_modes)} ({', '.join(sorted(all_modes))})"
    )


if __name__ == "__main__":
    test_load_modes_from_file()
