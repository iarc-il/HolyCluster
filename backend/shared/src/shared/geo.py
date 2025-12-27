import csv
import json
from pathlib import Path
import re

from loguru import logger
from pydantic import BaseModel

from shared.qrz import get_locator_from_qrz
from shared.coordinates import locator_to_coordinates


class GeoException(Exception):
    pass


class GeoData(BaseModel):
    cached: bool
    locator_source: str
    locator: str
    lon: float
    lat: float
    country: str
    continent: str


def read_csv_to_list_of_tuples(filename: str):
    with open(filename, "r") as file:
        csv_reader = csv.reader(file)
        return [tuple(row) for row in csv_reader]


current_folder = Path(__file__).parent
callsign_to_locator_filename = f"{current_folder}/prefixes_list.csv"
PREFIXES_TO_LOCATORS = read_csv_to_list_of_tuples(filename=callsign_to_locator_filename)


def resolve_locator_from_list(callsign: str, debug: bool = False) -> str:
    callsign = callsign.upper()
    for regex, locator, country, continent in PREFIXES_TO_LOCATORS:
        if re.match(regex + ".*", callsign):
            return locator
    return None


def resolve_country_and_continent_from_list(callsign: str, debug: bool = False) -> tuple[str, str]:
    callsign = callsign.upper()
    for regex, locator, country, continent in PREFIXES_TO_LOCATORS:
        if re.match(regex + ".*", callsign):
            return country, continent
    raise GeoException(f"Failed to resolve country and continent for {callsign}")


async def get_geo_details(
    valkey_client,
    qrz_session_key: str,
    callsign: str,
    geo_expiration: int,
) -> GeoData:
    # Get geo details from cache
    geo_data = await valkey_client.get(callsign)

    if geo_data:
        geo_data = json.loads(geo_data)
        geo_data["cached"] = True
    else:
        # Get locator from qrz
        qrz_locator_dict = await get_locator_from_qrz(
            qrz_session_key=qrz_session_key,
            callsign=callsign,
            delay=0,
        )
        if qrz_locator_dict is None:
            logger.error(f"get_locator_from_qrz returned None for {callsign}, falling back to prefix list")
            qrz_locator_dict = {"locator": None, "error": "Function returned None"}

        locator = qrz_locator_dict.get("locator")
        if locator:
            locator_source = "qrz"
        else:
            locator = resolve_locator_from_list(callsign=callsign)
            if locator:
                locator_source = "prefixes list"

        if locator:
            # Get country & continent from prefixed list (CSV file)
            country, continent = resolve_country_and_continent_from_list(callsign=callsign)
            lat, lon = locator_to_coordinates(locator)

            # Add geo details to cache
            geo_data = {
                "locator_source": locator_source,
                "locator": locator,
                "lat": lat,
                "lon": lon,
                "country": country,
                "continent": continent,
            }
            await valkey_client.set(callsign, json.dumps(geo_data), ex=geo_expiration)
            geo_data["cached"] = False
        else:
            raise GeoException(f"Missing locator for callsign {callsign}")
    return GeoData(**geo_data)
