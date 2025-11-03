import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[3]))

from collectors.src.enrichers.frequencies import load_bands_from_csv

def test_load_bands_from_csv():
    # Path to the bands.csv file
    csv_path = Path(__file__).parent / '../../src/enrichers/bands.csv'
    bands = load_bands_from_csv(csv_path)
    
    # Assert that bands is a list
    assert isinstance(bands, list)
    
    # Assert that each item is a tuple of (str, float, float)
    for band in bands:
        assert isinstance(band, tuple)
        assert len(band) == 3
        assert isinstance(band[0], str)
        assert isinstance(band[1], float)
        assert isinstance(band[2], float)
    
    # Assert specific values, e.g., first band
    assert bands[0] == ('40m', 7000.0, 7300.0)
    
    print(f"Loaded {len(bands)} bands successfully.")

if __name__ == "__main__":
    test_load_bands_from_csv()
