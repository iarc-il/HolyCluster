import json
from time import time
import sys
from pathlib import Path
from loguru import logger
import asyncio
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.exc import ProgrammingError, OperationalError

import settings
from db_classes import DxheatRaw, HolySpot, GeoCache, SpotWithIssue
from spots_collector import get_dxheat_spots, prepare_dxheat_record, prepare_holy_spot
from qrz import get_qrz_session_key
# from location import read_csv_to_list_of_tuples

from settings import (
    DEBUG,
    QRZ_USER,
    QRZ_PASSOWRD,
    QRZ_API_KEY,
)

geo_cache:dict = {}

# 2 directories up
grandparent_folder = Path(__file__).parents[1]
sys.path.append(f"{grandparent_folder}")


def string_to_boolean(value: str) -> bool:
    if value.strip().lower() == "true":
        return True
    elif value.strip().lower() == "false":
        return False

async def prepare_holy_spots_records(holy_spots_list: list, 
                                     qrz_session_key: str, 
                                    #  prefixes_to_locators: list,
                                     geo_cache: dict,
                                     debug: bool=False) -> list:
        start = time()
        tasks = []
        accumulated_delay = 0
        for index, spot in enumerate(holy_spots_list):
            if spot.spotter not in geo_cache or spot.dx_call not in geo_cache:
                accumulated_delay += 1/20
                delay = accumulated_delay 
            else:
                delay = 0

            task = asyncio.create_task(prepare_holy_spot(
                date=spot.date,
                time=spot.time,
                mode=spot.mode,
                band=spot.band,
                frequency=spot.frequency,
                spotter_callsign=spot.spotter,
                dx_callsign=spot.dx_call,
                dx_locator=spot.dx_locator,
                comment=spot.comment,
                qrz_session_key=qrz_session_key,
                # prefixes_to_locators=prefixes_to_locators,
                geo_cache=geo_cache,
                delay=delay,
                debug=debug
            ))
            tasks.append(task)
        all_records = await asyncio.gather(*tasks)
        # logger.debug(f"{all_records=}")
        holy_spots_records, geo_cache_spotter_records, geo_cache_dx_records = zip(*all_records)
        if debug:
            logger.debug(f"{holy_spots_records=}")
            logger.debug(f"{geo_cache_spotter_records=}")
            logger.debug(f"{geo_cache_dx_records=}")
        end = time()
        if debug:
            logger.debug(f"Elasped time: {end - start:.2f} seconds")
        
        return holy_spots_records, geo_cache_spotter_records, geo_cache_dx_records

async def collect_dxheat_spots(debug=False):
    bands = [160, 80, 40, 30, 20, 17, 15, 12, 10, 6]
    start = time()
    tasks = []
    for band in bands:
        task = asyncio.create_task(get_dxheat_spots(band=band, limit=30))
        tasks.append(task)
    all_spots = await asyncio.gather(*tasks)

    if debug:
        logger.debug(f"all_spots=\n{all_spots}")
    end = time()
    if debug:
        logger.debug(f"Elasped time: {end - start:.2f} seconds")

    spot_records = []
    for spots_in_band in all_spots:
        if debug:
            logger.debug(f"list=\n{spots_in_band}")
        for spot in spots_in_band:
            if debug:
                logger.debug(f"spot={spot}")
            record = prepare_dxheat_record(spot)
            spot_records.append(record)
            if debug:
                logger.debug(f"record={record}")

    return spot_records


def add_spot_to_spots_with_issues_file(spot:dict):
    spots_with_issues = f"{grandparent_folder}/src/spots_with_issues.txt"
    with open(spots_with_issues, 'a') as f:
        f.write('-' * 50 + '\n')
        for key, value in spot.items():
            f.write(f'{key}: {value}\n')

async def main(debug=False):
    holy_spots_list = []
    qrz_session_key = get_qrz_session_key(username=QRZ_USER, password=QRZ_PASSOWRD, api_key=QRZ_API_KEY)    
    
    # callsign_to_locator_filename = f"{grandparent_folder}/src/prefixes_list.csv"
    # if debug:
    #     logger.debug(f"{callsign_to_locator_filename=}")
    # prefixes_to_locators = read_csv_to_list_of_tuples(filename=callsign_to_locator_filename)

    engine = create_engine(settings.DB_URL, echo=False)
    Session = sessionmaker(bind=engine)
    session = Session()

    with engine.connect() as connection:
        connection.execution_options(isolation_level="AUTOCOMMIT")  # Set isolation level to autocommit
        try:
            # Reading GeoCache
            geo_cache = { 
                row.callsign: {
                    'locator': row.locator, 
                    'lat': row.lat, 
                    'lon': row.lon, 
                    'country': row.country,
                    'continent': row.continent,
                } 
                for row in session.query(GeoCache).all()
            }
            if debug:
                logger.debug(f"{json.dumps(geo_cache, indent=4, sort_keys=False)}")

            #  dxheat_raw
            spot_records = await collect_dxheat_spots(debug=debug)
            for record in spot_records:
                dxheat_record_to_dict = record.to_dict()
                stmt = insert(DxheatRaw).values(**dxheat_record_to_dict)
                # Define the conflict resolution (do nothing on conflict)
                stmt = stmt.on_conflict_do_nothing(
                    index_elements=['date', 'time', 'spotter', 'dx_call']
                    # index_elements=['id'],  # The unique column causing the conflict
                )                
                # Execute the statement
                session.execute(stmt)

                if  record.valid:
                    holy_spots_list.append(record)

            holy_spots_records, geo_cache_spotter_records, geo_cache_dx_records = await prepare_holy_spots_records(holy_spots_list=holy_spots_list, 
                                                                  qrz_session_key=qrz_session_key,
                                                                #   prefixes_to_locators=prefixes_to_locators,
                                                                  geo_cache=geo_cache,
                                                                  debug=debug)
            # holy_spot
            for record in holy_spots_records:
                if debug:
                    logger.debug(f"{record=}")
                holy_spot_record_dict = record.to_dict()
                if holy_spot_record_dict['spotter_locator'] and holy_spot_record_dict['dx_locator']:
                    stmt = insert(HolySpot).values(**holy_spot_record_dict)
                else:
                    stmt = insert(SpotWithIssue).values(**holy_spot_record_dict)
                    logger.error(f"Issues with spot:\n{holy_spot_record_dict}")
                # Removing duplication by: Define the conflict resolution (do nothing on conflict)
                stmt = stmt.on_conflict_do_nothing(
                    index_elements=['date', 'time', 'spotter_callsign', 'dx_callsign']
                )                
                # Execute the statement
                session.execute(stmt)

            session.commit()

            # geo_cache
            for record in geo_cache_spotter_records + geo_cache_dx_records:
                if debug:
                    logger.debug(f"{record=}")
                geo_cache_record_dict = record.to_dict()
                stmt = insert(GeoCache).values(**geo_cache_record_dict)
                # Removing duplication by: Define the conflict resolution (do nothing on conflict)
                stmt = stmt.on_conflict_do_nothing(
                    index_elements=['id']
                )                
                # Execute the statement
                session.execute(stmt)
            session.commit()

            # DX Lite
            # TBD

        except (ProgrammingError, OperationalError) as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    start = time()
    logger.info(f"DEBUG={DEBUG}")
    if string_to_boolean(DEBUG):
        logger.info("DEBUG is True")
    else:
        logger.info("DEBUG is False")
    exit()
    asyncio.run(main(debug=DEBUG))
    end = time()
    if DEBUG:
        logger.debug(f"Elasped time: {end - start:.2f} seconds")
