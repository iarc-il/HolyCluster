from datetime import datetime, time, date
import json
# from time import time
import sys
from pathlib import Path
from loguru import logger
import asyncio

import settings
from db_classes import DxheatRaw, HolySpot, GeoCache, SpotWithIssue
from spots_collector import get_dxheat_spots, prepare_dxheat_record, prepare_holy_spot
from run_collector import prepare_holy_spots_records 
from qrz import get_qrz_session_key
from misc import string_to_boolean, open_log_file

from settings import (
    DEBUG,
    QRZ_USER,
    QRZ_PASSOWRD,
    QRZ_API_KEY,
)

async def main(debug=False):
    logger.debug('main')
    geo_cache: dict = {}
    qrz_session_key = get_qrz_session_key(username=QRZ_USER, password=QRZ_PASSOWRD, api_key=QRZ_API_KEY)    
    if debug:
        logger.debug(f"{qrz_session_key=}")

    record = DxheatRaw(
        number='63474769',
        spotter='IW3GTZ',
        frequency='14180.0',
        dx_call='IZ3WUW/P',
        time=time(15,57,00),
        date=date(2025,5,18),
        date_time=datetime(2025, 5, 18, 15, 57, 0),
        beacon='f',
        mm='f',
        am='f',
        valid='t',
        lotw=None,
        lotw_date=None,
        esql=None,
        dx_homecall='IZ3WUW',
        comment='cq around',
        flag='it',
        band='20.0',
        mode='USB',
        missing_mode='f',
        continent_dx='EU',
        continent_spotter='EU',
        dx_locator='JN61GV'
    )

    if debug:
        logger.debug(f"{record}")

    holy_spots_list = [
        record
    ]

    holy_spots_records, geo_cache_spotter_records, geo_cache_dx_records = await prepare_holy_spots_records(holy_spots_list=holy_spots_list, 
                                                            qrz_session_key=qrz_session_key,
                                                            geo_cache=geo_cache,
                                                            debug=debug)

    if debug:
        logger.debug(f"{prepare_holy_spots_records=}")
        logger.debug(f"{geo_cache_spotter_records=}")
        logger.debug(f"{geo_cache_dx_records=}")


if __name__ == '__main__':
    debug=True
    asyncio.run(main(debug=debug))

