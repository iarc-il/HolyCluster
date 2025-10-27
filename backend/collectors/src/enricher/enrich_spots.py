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
            band = row[0]
            freq_start = float(row[1])
            freq_end = float(row[2])
            bands.append((band, freq_start, freq_end))
    return bands

def find_band_and_mode(frequency:str, comment:str, debug: bool=False)->List:
    pass


