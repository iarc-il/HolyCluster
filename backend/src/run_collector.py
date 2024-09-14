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
from db_classes import DxheatRaw, HollySpot, GeoCache, CallsignToLocator
from spots_collector import get_dxheat_spots, prepare_dxheat_record, prepare_holy_spot
from qrz import get_qrz_session_key
from location import read_csv_to_list_of_tuples

from settings import (
    QRZ_USER,
    QRZ_PASSOWRD,
    QRZ_API_KEY,
)

# 2 directories up
grandparent_folder = Path(__file__).parents[1]
sys.path.append(f"{grandparent_folder}")


async def prepare_holy_spots_records(holy_spots_list: list, 
                                     qrz_session_key: str, 
                                     prefixes_to_locators: list,
                                     callsign_to_locator_cache: CallsignToLocator,
                                     debug: bool=False) -> list:
        start = time()
        tasks = []
        for index, spot in enumerate(holy_spots_list):
            
            task = asyncio.create_task(prepare_holy_spot(
                date=spot.date,
                time=spot.time,
                mode=spot.mode,
                band=spot.band,
                frequency=spot.frequency,
                spotter_callsign=spot.spotter,
                dx_callsign=spot.dx_call,
                dx_locator=spot.dx_locator,
                qrz_session_key=qrz_session_key,
                prefixes_to_locators=prefixes_to_locators,
                callsign_to_locator_cache=callsign_to_locator_cache,
                delay=index/50,
                debug=debug
            ))
            tasks.append(task)
        holy_spots_records = await asyncio.gather(*tasks)

        end = time()
        if debug:
            logger.debug(f"Elasped time: {end - start:.2f} seconds")
        
        return holy_spots_records

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


async def main(debug=False):
    engine = create_engine(settings.DB_URL, echo=True)
    holy_spots_list = []
    callsign_to_locator_cache = CallsignToLocator()

    qrz_session_key = get_qrz_session_key(username=QRZ_USER, password=QRZ_PASSOWRD, api_key=QRZ_API_KEY)    
    # Create a configured "Session" class
    Session = sessionmaker(bind=engine)

    callsign_to_locator_filename = f"{grandparent_folder}/src/prefixes_to_locators.csv"
    if debug:
        logger.debug(f"{callsign_to_locator_filename=}")
    prefixes_to_locators = read_csv_to_list_of_tuples(filename=callsign_to_locator_filename)

    # Create a Session
    session = Session()

    with engine.connect() as connection:
        connection.execution_options(isolation_level="AUTOCOMMIT")  # Set isolation level to autocommit
        try:
            # DX Heat
            spot_records = await collect_dxheat_spots(debug=debug)
            for record in spot_records:
                d = record.to_dict()
                stmt = insert(DxheatRaw).values(**d)
                # Define the conflict resolution (do nothing on conflict)
                stmt = stmt.on_conflict_do_nothing(
                    index_elements=['number'],  # The unique column causing the conflict
                )                
                # Execute the statement
                session.execute(stmt)

                if  record.valid:
                    holy_spots_list.append(record)

            holy_spots_records = await prepare_holy_spots_records(holy_spots_list=holy_spots_list, 
                                                                  qrz_session_key=qrz_session_key,
                                                                  prefixes_to_locators=prefixes_to_locators,
                                                                  callsign_to_locator_cache=callsign_to_locator_cache,
                                                                  debug=debug)

            for record in holy_spots_records:
                if debug:
                    logger.debug(f"{record=}")
                d = record.to_dict()
                stmt = insert(HollySpot).values(**d)
                # Define the conflict resolution (do nothing on conflict)
                stmt = stmt.on_conflict_do_nothing(
                    index_elements=['date', 'time', 'spotter_callsign', 'dx_callsign']
                )                
                # Execute the statement
                session.execute(stmt)

            session.commit()

            # DX Lite
            # TBD

        except (ProgrammingError, OperationalError) as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    debug = True
    asyncio.run(main(debug=debug))
