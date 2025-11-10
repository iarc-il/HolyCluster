import argparse
import os
import time
import re
import json
import asyncio
from loguru import logger

from collectors.src.misc import open_log_file
from collectors.src.db.valkey_config import get_valkey_client
from collectors.src.enrichers.frequencies import find_band_and_mode
from collectors.src.enrichers.geo import get_geo_details

from collectors.src.settings import (
    DEBUG,
    VALKEY_HOST,
    VALKEY_PORT,
    VALKEY_DB,
)

global valkey_client
valkey_client = get_valkey_client(host=VALKEY_HOST, port=VALKEY_PORT, db=VALKEY_DB)


async def enrich_telnet_spot(spot: dict, debug: bool = False):
    try:
        # Enrich band and mode
        if debug:
            logger.debug(f"{spot=}")
        band, mode, mode_selection =  find_band_and_mode(frequency=spot['frequency'], comment=spot['comment'], debug=debug)
        if debug:
                logger.debug(f"{band=}   {mode=}   {mode_selection=}")
        spot.update({'band': band, 'mode': mode, 'mode_selection': mode_selection})
        if debug:
            logger.debug(f"{spot=}")

        # Enrich locator
        spotter_geo_cache, spotter_locator_source, spotter_locator, spotter_lat, spotter_lon, spotter_country, spotter_continent = await get_geo_details(spot['spotter_callsign'])
        dx_geo_cache, dx_locator_source, dx_locator, dx_lat, dx_lon, dx_country, dx_continent = await get_geo_details(spot['dx_callsign'])
        spot.update({
            'spotter_geo_cache': spotter_geo_cache,
            'spotter_locator_source': spotter_locator_source,
            'spotter_locator': spotter_locator,
            'spotter_lat': spotter_lat,
            'spotter_lon': spotter_lon,
            'spotter_country': spotter_country,
            'spotter_continent': spotter_continent,
            'dx_geo_cache': dx_geo_cache,
            'dx_locator_source': dx_locator_source,
            'dx_locator': dx_locator,
            'dx_lat': dx_lat,
            'dx_lon': dx_lon,
            'dx_country': dx_country,
            'dx_continent': dx_continent,
        })
        logger.info(f"{spot=}")


        if debug:
            logger.debug(40*"-")
    except Exception as ex:
        message = f"**** ERROR enrich_telnet_spot **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)


async def spots_consumer(debug: bool = False):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    log_filename = f"enrich_telnet_spots"
    log_dir = os.path.join(script_dir, '..', '..', 'logs')
    os.makedirs(log_dir, exist_ok=True)
    telnet_log_dir = os.path.join(log_dir, 'telnet_collectors')
    os.makedirs(telnet_log_dir, exist_ok=True)
    log_path = os.path.join(telnet_log_dir, log_filename)
    open_log_file(log_filename_prefix=log_path, debug=debug)
    logger.info(f"spots_consumer started")

    STREAM_NAME = "telnet"
    CONSUMER_GROUP = "telnet_group"
    CONSUMER_NAME = "consumer_1"
# Create consumer group (only first time)
    try:
        valkey_client.xgroup_create(STREAM_NAME, CONSUMER_GROUP, id='0', mkstream=True)
    except redis.exceptions.ResponseError:
        # Group already exists
        pass

    last_id = '>'
    while True:
        try:
            # Block until a message arrives
            resp = valkey_client.xreadgroup(CONSUMER_GROUP, CONSUMER_NAME, {STREAM_NAME: last_id}, count=10, block=5000)
            if not resp:
                continue

            for stream_name, messages in resp:
                # if debug:
                #     logger.debug(f"{stream_name=}   {messages=}")
                for msg_id, spot in messages:
                    if debug:
                        logger.debug(f"{msg_id=}")
                        logger.debug(f"spot={json.dumps(spot, indent=4)}")
                    valkey_client.xack(STREAM_NAME, CONSUMER_GROUP, msg_id)
                    valkey_client.xtrim(STREAM_NAME, minid=msg_id, approximate=False)
                    await enrich_telnet_spot(spot=spot, debug=debug)

        except exception as ex:
            message = f"**** ERROR consume_spots **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
            logger.error(message)

if __name__ == "__main__":
    asyncio.run(spots_consumer(debug=DEBUG))
