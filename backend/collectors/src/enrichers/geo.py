import asyncio
import re
import json
import csv
from typing import List
from pathlib import Path
import redis
import socket
from loguru import logger

from collectors.src.enrichers.locator import resolve_locator_from_list, resolve_country_and_continent_from_list
from collectors.src.enrichers.coordinates import locator_to_coordinates
from collectors.src.db.valkey_config import get_valkey_client
from collectors.src.settings import (
    VALKEY_HOST,
    VALKEY_PORT,
    VALKEY_DB,
    VALKEY_GEO_EXPIRATION,
)
from collectors.src.enrichers.qrz import get_locator_from_qrz

global valkey_client
try:
    if not socket.gethostbyname(VALKEY_HOST):
        pass
except socket.gaierror as e:
    VALKEY_HOST="127.0.0.1"
valkey_client = get_valkey_client(host=VALKEY_HOST, port=VALKEY_PORT, db=VALKEY_DB)



async def check_geo_cache(callsign: str, debug: bool = False):
    geo_cache_details = None
    try:
        geo_cache_details = valkey_client.get(callsign)
        if debug:
            logger.debug(f"{geo_cache_details=}")

    except Exception as ex:
        message = f"**** ERROR check_geo_cache **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)

    finally:
        return geo_cache_details


async def add_geo_cache(callsign: str, geo_details_str: str, debug: bool = False):
    if debug:
        logger.debug(f"Adding to geo_cache: {geo_details_str=}")
#
    try:
        valkey_client.set(callsign, geo_details_str, ex=VALKEY_GEO_EXPIRATION)

    except Exception as ex:
        message = f"**** ERROR check_geo_cache **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)

    finally:
        return 


async def get_geo_details(qrz_session_key: str, callsign: str, debug: bool = False):
    locator = None
    locator_source = None
    lat = None
    lon = None
    country = None
    continent = None

    # Get geo details from cache
    geo_cache_details = await check_geo_cache(callsign=callsign, debug=debug)

    if geo_cache_details:
        geo_cache = 1 
        geo = json.loads(geo_cache_details)
        locator = geo['locator']
        locator_source = geo['locator_source']
        lat = geo['lat']
        lon = geo['lon']
        country = geo['country']
        continent = geo['continent']

    else:
        geo_cache = 0
        # Get locator from qrz
        qrz_locator_dict = await get_locator_from_qrz(
            qrz_session_key=qrz_session_key, 
            callsign=callsign,
            delay=0, 
            debug=debug
        )
        locator = qrz_locator_dict['locator']
        if locator:
            locator_source = "qrz"
        else:
            # Get locator from prefixes list (CSV file)
            if 'error' in qrz_locator_dict:
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
                'locator_source': locator_source,
                'locator' : locator,
                'lat' : lat,
                'lon' : lon,
                'country' : country,
                'continent' : continent
            }
            geo_details_str = json.dumps(geo_details_dict)
            await add_geo_cache(callsign=callsign, geo_details_str=geo_details_str, debug=debug)


    if debug:
        logger.debug(f"{callsign=}")

    return geo_cache, locator_source, locator, lat, lon, country, continent
