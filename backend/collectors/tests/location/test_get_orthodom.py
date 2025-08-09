import sys
from pathlib import Path
from loguru import logger

grandparent_folder = Path(__file__).parents[2] # 2 directories up
sys.path.append(f"{grandparent_folder}")
from src.orthodom import orthodrome

spotter_lat, spotter_lon = orthodrome.locator_to_coordinates("DM57")
logger.debug(f"{spotter_lat=}   {spotter_lon=}")
dx_lat, dx_lon = orthodrome.locator_to_coordinates("KM72")
logger.debug(f"{dx_lat=}   {dx_lon=}")

n=15
orthodrome_pts = orthodrome.get_orthodrome(spotter_lat, spotter_lon, dx_lat, dx_lon, n)
logger.debug(f"{orthodrome_pts}")
print("Intermediate points:")
for i, point in enumerate(orthodrome_pts):
    print(f"Point {i+1}: {point}")


