import sys
from pathlib import Path
from loguru import logger

grandparent_folder = Path(__file__).parents[2] # 2 directories up
sys.path.append(f"{grandparent_folder}")
from src.orthodom import orthodrome

lat, lon = orthodrome.locator_to_coordinates("DM57")
logger.debug(f"{lat=}   {lon=}")
