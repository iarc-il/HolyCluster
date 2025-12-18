import json
import socket
from loguru import logger

from collectors.enrichers.locator import resolve_locator_from_list, resolve_country_and_continent_from_list
from collectors.enrichers.coordinates import locator_to_coordinates
from collectors.db.valkey_config import get_valkey_client
from collectors.settings import (
    VALKEY_HOST,
    VALKEY_PORT,
    VALKEY_DB,
    VALKEY_GEO_EXPIRATION,
)
from collectors.enrichers.qrz import get_locator_from_qrz

global valkey_client
try:
    if not socket.gethostbyname(VALKEY_HOST):
        pass
except socket.gaierror:
    VALKEY_HOST = "127.0.0.1"
valkey_client = get_valkey_client(host=VALKEY_HOST, port=VALKEY_PORT, db=VALKEY_DB)


async def get_geo_details(qrz_session_key: str, callsign: str, debug: bool = False):
    locator = None
    locator_source = None
    lat = None
    lon = None
    country = None
    continent = None

    # Get geo details from cache
    geo_cache_details = valkey_client.get(callsign)

    if geo_cache_details:
        geo_cache = 1
        geo = json.loads(geo_cache_details)
        locator = geo["locator"]
        locator_source = geo["locator_source"]
        lat = geo["lat"]
        lon = geo["lon"]
        country = geo["country"]
        continent = geo["continent"]

    else:
        geo_cache = 0
        # Get locator from qrz
        qrz_locator_dict = await get_locator_from_qrz(
            qrz_session_key=qrz_session_key, callsign=callsign, delay=0, debug=debug
        )
        if qrz_locator_dict is None:
            logger.error(f"get_locator_from_qrz returned None for {callsign}, falling back to prefix list")
            qrz_locator_dict = {"locator": None, "error": "Function returned None"}

        locator = qrz_locator_dict.get("locator")
        if locator:
            locator_source = "qrz"
        else:
            # Get locator from prefixes list (CSV file)
            if "error" in qrz_locator_dict:
                if debug:
                    logger.debug(f"{qrz_locator_dict['error']}")
            locator = resolve_locator_from_list(callsign=callsign, debug=debug)
            if locator:
                locator_source = "prefixes list"

        if locator:
            # Get country & continent from prefixed list (CSV file)
            country, continent = resolve_country_and_continent_from_list(callsign=callsign, debug=debug)
            # Calculate coordinates
            lat, lon = locator_to_coordinates(locator)

            # Add geo details to cache
            geo_details_dict = {
                "locator_source": locator_source,
                "locator": locator,
                "lat": lat,
                "lon": lon,
                "country": country,
                "continent": continent,
            }
            geo_details_str = json.dumps(geo_details_dict)
            valkey_client.set(callsign, geo_details_str, ex=VALKEY_GEO_EXPIRATION)

    if debug:
        logger.debug(f"{callsign=}")

    return geo_cache, locator_source, locator, lat, lon, country, continent
