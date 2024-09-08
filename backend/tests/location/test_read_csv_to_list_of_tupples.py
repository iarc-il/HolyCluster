import sys
from pathlib import Path
from loguru import logger


grandparent_folder = Path(__file__).parents[2] # 2 directories up
sys.path.append(f"{grandparent_folder}")
from src.location import read_csv_to_list_of_tuples

filename = f"{grandparent_folder}/src/callsign_to_locatore.csv"
logger.debug(filename)
callsigns_to_locators = read_csv_to_list_of_tuples(filename=filename)
logger.debug(f"{callsigns_to_locators=}")
