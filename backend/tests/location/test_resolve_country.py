import sys
from pathlib import Path
from loguru import logger

grandparent_folder = Path(__file__).parents[2] # 2 directories up
sys.path.append(f"{grandparent_folder}")
from src.location import read_csv_to_list_of_tuples, resolve_country_and_continent

filename = f"{grandparent_folder}/src/prefixes_to_locators.csv"
logger.debug(filename)
prefixes_to_locators = read_csv_to_list_of_tuples(filename=filename)
#logger.debug(f"{prefixes_to_locators=}")

random_call_signs = [
    "W1ABC", "VE2DEF", "G3GHI", "JA4JKL", "VK5MNO",
    "DL6PQR", "EA7STU", "F8VWX", "PA9YZA", "SM0BCD",
    "LU1EFG", "ZS2HIJ", "9A3KLM", "RA4NOP", "YB5QRS",
    "ZL6TUV", "CE7WXY", "5B8ZAB", "HB9CDE", "OZ1FGH",
    "W2IJK", "VE3LMN", "G4OPQ", "JA5RST", "VK6UVW",
    "DL7XYZ", "EA8ABC", "F9DEF", "PA0GHI", "SM1JKL",
    "LU2MNO", "ZS3PQR", "9A4STU", "RA5VWX", "YB6YZA",
    "ZL7BCD", "CE8EFG", "5B9HIJ", "HB0KLM", "OZ2NOP",
    "W3QRS", "VE4TUV", "G5WXY", "JA6ZAB", "VK7CDE",
    "DL8FGH", "EA9IJK", "F0LMN", "PA1OPQ", "SM2RST",
    "LU3UVW", "ZS4XYZ", "9A5ABC", "RA6DEF", "YB7GHI",
    "ZL8JKL", "CE9MNO", "5B0PQR", "HB1STU", "OZ3VWX",
    "W4YZA", "VE5BCD", "G6EFG", "JA7HIJ", "VK8KLM",
    "DL9NOP", "EA0QRS", "F1TUV", "PA2WXY", "SM3ZAB",
    "LU4CDE", "ZS5FGH", "9A6IJK", "RA7LMN", "YB8OPQ",
    "ZL9RST", "CE0UVW", "5B1XYZ", "HB2ABC", "OZ4DEF",
    "W5GHI", "VE6JKL", "G7MNO", "JA8PQR", "VK9STU",
    "DL0VWX", "EA1YZA", "F2BCD", "PA3EFG", "SM4HIJ",
    "LU5KLM", "ZS6NOP", "9A7QRS", "RA8TUV", "YB9WXY",
    "ZL0ZAB", "CE1CDE", "5B2FGH", "HB3IJK", "OZ5LMN"
]
for callsign in random_call_signs:
    country, continent = resolve_country_and_continent(callsign=callsign, prefixes_to_locators=prefixes_to_locators)
    logger.debug(f"{callsign=:7}   {country=} {continent=}")
