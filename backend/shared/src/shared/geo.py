import csv
import json
import re
from pathlib import Path

from pydantic import BaseModel

from shared.coordinates import locator_to_coordinates
from shared.qrz import get_locator_from_qrz


class GeoException(Exception):
    def __init__(self, callsign: str, callsign_type: str, data_type: str):
        self.callsign = callsign
        self.callsign_type = callsign_type
        self.data_type = data_type


class GeoData(BaseModel):
    cached: bool
    locator_source: str
    locator: str
    lon: float
    lat: float
    country: str
    continent: str
    state: str


def read_csv_to_list_of_tuples(filename: str):
    with open(filename, "r") as file:
        csv_reader = csv.reader(file)
        return [tuple(row) for row in csv_reader]


current_folder = Path(__file__).parent
callsign_to_locator_filename = f"{current_folder}/prefixes_list.csv"
PREFIXES_TO_LOCATORS = read_csv_to_list_of_tuples(filename=callsign_to_locator_filename)


def resolve_locator_from_list(callsign: str) -> str | None:
    callsign = callsign.upper()
    for regex, locator, country, continent in PREFIXES_TO_LOCATORS:
        if re.match(regex + ".*", callsign):
            return locator
    return None


def resolve_country_and_continent_from_list(callsign: str, callsign_type: str) -> tuple[str, str]:
    callsign = callsign.upper()
    for regex, locator, country, continent in PREFIXES_TO_LOCATORS:
        if re.match(regex + ".*", callsign):
            return country, continent
    raise GeoException(callsign, callsign_type, "country_and_continent")


async def get_geo_details(
    valkey_client,
    qrz_session_key: str,
    callsign: str,
    geo_expiration: int,
    http_client,
    callsign_type,
) -> GeoData:
    # Get geo details from cache
    if valkey_client is not None:
        geo_data = await valkey_client.get(callsign)
    else:
        geo_data = None

    if geo_data:
        geo_data = json.loads(geo_data)
        geo_data["cached"] = True
        return GeoData(**geo_data)

    qrz_locator_dict = await get_locator_from_qrz(qrz_session_key, callsign, http_client)

    locator = qrz_locator_dict.get("locator")
    state = qrz_locator_dict.get("state")
    if locator:
        locator_source = "qrz"
    else:
        locator = resolve_locator_from_list(callsign)
        if locator:
            locator_source = "prefixes list"
        else:
            raise GeoException(callsign, callsign_type, "locator")

    country, continent = resolve_country_and_continent_from_list(callsign, callsign_type)
    lat, lon = locator_to_coordinates(locator)

    geo_data = {
        "locator_source": locator_source,
        "locator": locator,
        "lat": lat,
        "lon": lon,
        "country": country,
        "continent": continent,
        "state": state or "",
    }
    if valkey_client is not None:
        await valkey_client.set(callsign, json.dumps(geo_data), ex=geo_expiration)
    geo_data["cached"] = False

    return GeoData(**geo_data)
