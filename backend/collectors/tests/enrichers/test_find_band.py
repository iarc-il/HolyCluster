import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[3]))

from collectors.src.enrichers.frequencies import load_bands_from_file, find_band

def test_find_band(debug: bool = False):
    # Path to the bands.csv file
    csv_path = Path(__file__).parent / '../../src/enrichers/bands.csv'
    bands = load_bands_from_file(csv_path)
    
    # Test find_band for each band
    for band, start, end in bands:
        # Pick a frequency in the middle of the band
        test_freq = (start + end) / 2
        result = find_band(str(test_freq))
        assert result == band, f"Expected {band} for {test_freq}, got {result}"
        print(f"Tested {band}: {test_freq} -> {result}")
    
    # Test out of range
    result = find_band(frequency="1", debug=debug)
    assert result == "", f"Expected '' for 1, got {result}"
    
    result = find_band(frequency="3000", debug=debug)  # Between 160m (2000) and 80m (3500)
    assert result == "", f"Expected '' for 3000, got {result}"
    
    result = find_band(frequency="100000000", debug=debug)
    assert result == "", f"Expected '' for 100000000, got {result}"
    
    print(f"Loaded {len(bands)} bands and tested successfully.")

if __name__ == "__main__":
    debug = True
    test_find_band(debug=debug)

