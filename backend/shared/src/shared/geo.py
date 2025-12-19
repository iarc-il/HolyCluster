import json
from loguru import logger

from shared.qrz import get_locator_from_qrz
from shared.coordinates import locator_to_coordinates
from shared.locator import resolve_locator_from_list, resolve_country_and_continent_from_list


async def get_geo_details(
    valkey_client,
    qrz_session_key: str,
    callsign: str,
    geo_expiration: int,
):
    locator = None
    locator_source = None
    lat = None
    lon = None
    country = None
    continent = None

    # Get geo details from cache
    geo_cache_details = await valkey_client.get(callsign)

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
            qrz_session_key=qrz_session_key, callsign=callsign, delay=0,
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
            await valkey_client.set(callsign, geo_details_str, ex=geo_expiration)

    return geo_cache, locator_source, locator, lat, lon, country, continent
