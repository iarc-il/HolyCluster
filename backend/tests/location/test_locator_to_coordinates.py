import sys
from pathlib import Path
from loguru import logger

grandparent_folder = Path(__file__).parents[2] # 2 directories up
sys.path.append(f"{grandparent_folder}")
from src.location import locator_to_coordinates

locator = "KM71jf"
# locator = None
lat, lon = locator_to_coordinates(locator)
logger.debug(f"{lat=}   {lon=}")