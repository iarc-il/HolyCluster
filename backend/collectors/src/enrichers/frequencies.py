import re
import csv
from typing import List
from pathlib import Path
import json
from loguru import logger

def load_bands_from_file(filepath)->List:
    bands = []
    try:
        with open(filepath, newline='', encoding='utf-8') as csvfile:
            reader = csv.reader(csvfile)
            next(reader)  # skip header row
            for row in reader:
                if row and len(row) >= 3:
                    band = row[0]
                    freq_start = float(row[1])
                    freq_end = float(row[2])
                    bands.append((band, freq_start, freq_end))

    except Exception as ex:
        message = f"**** ERROR load_bands_from_file **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)

    finally:
        return bands

def load_modes_from_file(file_path)->dict:
    modes = {}
    try:
        with open(file_path, 'r') as f:
            modes = json.load(f)

    except Exception as ex:
        message = f"**** ERROR load_modes_from_file **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)

    finally:
        return modes


bands = load_bands_from_file(Path(__file__).parent / 'bands.csv')

modes = load_modes_from_file(Path(__file__).parent / 'modes.json')

def find_band(frequency:str, debug: bool=False) -> str:
    name = ""
    try:
        if debug:
            logger.debug(f"{frequency=}")
        frequency_khz = float(frequency)
        for band, start, end in bands:
            if start <= frequency_khz <= end:
                if debug:
                    logger.debug(f"{band=}")
                return band
        if debug:
            logger.debug(f"Band not found for {frequency=}")
        band = ""  # frequency not found

    except Exception as ex:
        message = f"**** ERROR find_band **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)

    finally:
        return band


def find_band_and_mode(frequency:str, comment:str, debug: bool=False)->List:
    try:
        band = find_band(frequency=frequency, debug=debug)
        mode = ""
        frequency_khz = float(frequency)
        if debug:
            logger.debug(f"{band=}")
            logger.debug(f"{frequency_khz=}")
        if band:
            if re.search("CW", comment.upper()):
                mode = "CW"    
            elif re.search("FT8", comment.upper()):
                mode = "FT8"    
            elif re.search("FT4", comment.upper()):
                mode = "FT4"
            elif re.search("RTTY", comment.upper()):
                mode = "RTTY"
            elif re.search("DIGI", comment.upper()) or re.search("VARAC", comment.upper()):
                mode = "DIGI"
            elif band in modes:
                if debug:
                    logger.debug(f"{modes[band]=}")
                for mode, start_end in modes[band].items():
                    start = start_end['start']
                    end = start_end['end']
                    if debug:
                        logger.debug(f"{mode=} {start=}  {end=}")
                    if start <= frequency_khz < end:
                        if debug:
                            logger.debug(f"Frequency {frequency} mode is: {mode}")
                        break

            else:
                mode = ""
                if debug:
                    logger.debug(f"Mode not found for {band=}   {comment=}")
        else:
            mode = ""
            if debug:
                logger.debug(f"Mode not found for {frequency=} since missign band")

        if debug:
            logger.debug(f"{mode=}")

    except Exception as ex:
        message = f"**** ERROR find_band_and_mode **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)

    finally:
        return band, mode



