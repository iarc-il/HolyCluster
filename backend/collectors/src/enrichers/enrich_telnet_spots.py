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
    QRZ_USER,
    QRZ_PASSOWRD,
    QRZ_API_KEY,
    QRZ_SESSION_KEY_REFRESH,
)
from collectors.src.enrichers.qrz import get_qrz_session_key 

global valkey_client
valkey_client = get_valkey_client(host=VALKEY_HOST, port=VALKEY_PORT, db=VALKEY_DB)


async def enrich_telnet_spot(qrz_session_key:str, spot: dict, debug: bool = False):
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
        spotter_geo_cache, spotter_locator_source, spotter_locator, spotter_lat, spotter_lon, spotter_country, spotter_continent = await get_geo_details(qrz_session_key=qrz_session_key, callsign=spot['spotter_callsign'], debug=debug)
        dx_geo_cache, dx_locator_source, dx_locator, dx_lat, dx_lon, dx_country, dx_continent = await get_geo_details(qrz_session_key=qrz_session_key, callsign=spot['dx_callsign'], debug=debug)
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
        logger.info(f"spot=\n{json.dumps(spot, indent=4)}")
        if debug:
            logger.debug(40*"-")
        return spot

    except Exception as ex:
        message = f"**** ERROR enrich_telnet_spot **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)
        return spot


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

    STREAM_NAME = "stream-telnet"
    CONSUMER_GROUP = "telnet_group"
    CONSUMER_NAME = "consumer_1"
# Create consumer group (only first time)
    try:
        valkey_client.xgroup_create(STREAM_NAME, CONSUMER_GROUP, id='0', mkstream=True)
    except redis.exceptions.ResponseError:
        # Group already exists
        pass

    last_id = '>'
    last_run = time.time()
    # global qrz_session_key
    qrz_session_key = get_qrz_session_key(username=QRZ_USER, password=QRZ_PASSOWRD, api_key=QRZ_API_KEY)    

    while True:
        try:
            now = time.time()
            if now - last_run >= QRZ_SESSION_KEY_REFRESH:
                logger.info(f"Refreshing QRZ key (every {QRZ_SESSION_KEY_REFRESH} seconds)")
                time.sleep(5) # sleepin 5 seconds to allow pervious QRZ calls to complete
                qrz_session_key = get_qrz_session_key(username=QRZ_USER, password=QRZ_PASSOWRD, api_key=QRZ_API_KEY)    
                last_run = now
            # Block until a message arrives
            resp = valkey_client.xreadgroup(CONSUMER_GROUP, CONSUMER_NAME, {STREAM_NAME: last_id}, count=10, block=5000)
            if not resp:
                continue

            for stream_name, messages in resp:
                for msg_id, spot in messages:
                    if debug:
                        logger.debug(f"{msg_id=}")
                        logger.debug(f"spot={json.dumps(spot, indent=4)}")
                    valkey_client.xack(STREAM_NAME, CONSUMER_GROUP, msg_id)
                    valkey_client.xtrim(STREAM_NAME, minid=msg_id, approximate=False)
                    enriched_spot = await enrich_telnet_spot(qrz_session_key=qrz_session_key,spot=spot, debug=debug)
                    enriched_spot_str = json.dumps(enriched_spot)
                    # Add enriched spot to psql stream
                    STREAM_PSQL = "stream-postres"
                    entry_id = valkey_client.xadd(STREAM_PSQL, enriched_spot, '*')
                    if debug:
                        logger.debug(f"enriched spot stored in Valkey: {entry_id=} {enriched_spot=}")
                    # Add enriched spot to api stream only if has both locators
                    STREAM_API = "stream-api"
                    if 'spotter_locator' in enriched_spot and 'dx_locator' in enriched_spot:
                        entry_id = valkey_client.xadd(STREAM_API, enriched_spot, '*')
                        if debug:
                            logger.debug(f"enriched spot stored in Valkey: {entry_id=} {enriched_spot=}")
                    

        except Exception as ex:
            message = f"**** ERROR spots_consumer **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
            logger.error(message)

if __name__ == "__main__":
    asyncio.run(spots_consumer(debug=DEBUG))
