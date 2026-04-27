import json
import re
from pathlib import Path
from typing import List, Tuple

from loguru import logger


def _find_band_plans() -> Path:
    path = Path(__file__).resolve().parent
    while path != path.parent:
        candidate = path / "shared" / "band_plans.json"
        if candidate.exists():
            return candidate
        path = path.parent
    raise FileNotFoundError("Could not find shared/band_plans.json")


def load_band_plans(filepath) -> Tuple[List, dict]:
    with open(filepath, "r") as f:
        data = json.load(f)

    bands = []
    modes = {}
    for band, info in data.items():
        bands.append((band, info["freq_start"], info["freq_end"]))
        modes[band] = info["modes"]

    return bands, modes


bands, modes = load_band_plans(_find_band_plans())


def find_band(frequency: str) -> str:
    frequency_khz = float(frequency)
    for band, start, end in bands:
        if start <= frequency_khz <= end:
            return band
    logger.debug(f"Band not found for {frequency=}")
    band = ""
    return band


class InvalidBandError(Exception):
    pass


def find_band_and_mode(frequency: str, comment: str) -> Tuple[str, str, str]:
    band = find_band(frequency)
    if not band:
        raise InvalidBandError(f"Band not found for frequency={frequency}")

    mode = ""
    mode_selection = ""
    frequency_khz = float(frequency)
    logger.debug(f"{band=}")
    logger.debug(f"{frequency_khz=}")
    if re.search("CW", comment.upper()):
        mode = "CW"
        mode_selection = "comment"
    elif re.search("FT8", comment.upper()):
        mode = "FT8"
        mode_selection = "comment"
    elif re.search("FT4", comment.upper()):
        mode = "FT4"
        mode_selection = "comment"
    elif re.search("FT2", comment.upper()):
        mode = "FT2"
        mode_selection = "comment"
    elif re.search("RTTY", comment.upper()):
        mode = "RTTY"
        mode_selection = "comment"
    elif re.search("DIGI", comment.upper()) or re.search("VARAC", comment.upper()) or re.search("MSK", comment.upper()):
        mode = "DIGI"
        mode_selection = "comment"
    elif band in modes:
        logger.debug(f"{modes[band]=}")
        for mode, start_end in modes[band].items():
            start = start_end["start"]
            end = start_end["end"]
            logger.debug(f"{mode=} {start=}  {end=}")
            if start <= frequency_khz < end:
                logger.debug(f"Frequency {frequency} mode is: {mode}")
                mode_selection = "range"
                break
    else:
        mode = ""
        logger.debug(f"Mode not found for {band=}   {comment=}")

    return band, mode, mode_selection
