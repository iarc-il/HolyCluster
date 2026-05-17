import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))

from collectors.enrichers.frequencies import load_band_plans


def test_load_band_plans():
    file_path = Path(__file__).parents[4] / "shared" / "band_plans.json"
    _, modes = load_band_plans(file_path)

    assert isinstance(modes, dict)

    assert modes["40"] == {
        "FT8": {"start": 7074, "end": 7077},
        "FT4": {"start": 7047.5, "end": 7050.5},
        "FT2": {"start": 7052, "end": 7055},
        "CW": {"start": 7000, "end": 7040},
        "SSB": {"start": 7100, "end": 7300},
    }
    assert all("RTTY" not in band_modes for band_modes in modes.values())

    # Count the number of modes per band
    for band, band_modes in modes.items():
        count = len(band_modes)
        print(f"Band {band}m has {count} mode(s): {', '.join(band_modes.keys())}")

    # Optional summary of all distinct modes
    all_modes = {mode for band_modes in modes.values() for mode in band_modes}
    print(f"\nTotal distinct modes across all bands: {len(all_modes)} ({', '.join(sorted(all_modes))})")


if __name__ == "__main__":
    test_load_band_plans()
