import re
import csv
from typing import List
from pathlib import Path
from loguru import logger

def load_bands_from_csv(filepath):
    bands = []
    with open(filepath, newline='', encoding='utf-8') as csvfile:
        reader = csv.reader(csvfile)
        next(reader)  # skip header row
        for row in reader:
            if row and len(row) >= 3:
                band = row[0]
                freq_start = float(row[1])
                freq_end = float(row[2])
                bands.append((band, freq_start, freq_end))
    return bands

bands = load_bands_from_csv(Path(__file__).parent / 'bands.csv')

def find_band(frequency:str, debug: bool=False) -> str:
    frequency_khz = float(frequency)
    for band, start, end in bands:
        if start <= frequency_khz <= end:
            return band
    return ""  # frequency not found

def find_band_and_mode(frequency:str, comment:str, debug: bool=False)->List:
    pass



