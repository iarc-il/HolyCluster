from datetime import datetime, timezone
from time import time, sleep
import json
import zipfile
import os
import sys
from pathlib import Path
import asyncio
import httpx
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlmodel import SQLModel, select
from sqlalchemy.dialects.postgresql import insert

# Add project root and src root to the path to allow direct imports
project_root = Path(__file__).resolve().parents[3]
src_root = Path(__file__).resolve().parents[1]
db_path = Path(__file__).resolve().parents[1] / "db"
sys.path.append(str(project_root))
sys.path.append(str(src_root))
sys.path.append(str(db_path))
from settings import (
    DEBUG,
    POSTGRES_DB_URL,
)
from misc import string_to_boolean, open_log_file
from db_classes import DxheatRaw


def prepare_dxheat_record(spot, debug=False):
    time = datetime.strptime(spot['Time'], '%H:%M').time()
    date = datetime.strptime(spot['Date'], '%d/%m/%y').date()
    missing_mode = False
    if "Mode" not in spot:
      spot["Mode"] = "SSB"
      missing_mode = True
    if not 'DXLocator' in spot:
        spot['DXLocator'] =  None
    record = DxheatRaw(
        number=spot['Nr'],
        spotter=spot['Spotter'],
        frequency=spot['Frequency'],
        dx_call=spot['DXCall'],
        time=time,
        date=date,
        date_time=datetime.combine(date, time),
        beacon=spot['Beacon'],
        mm=spot['MM'],
        am=spot['AM'],
        valid=spot['Valid'],
        lotw=spot['LOTW'] if 'LOTW' in spot else None,
        lotw_date=datetime.strptime(spot['LOTW_Date'], '%m/%d/%Y').date() if 'LOTW_Date' in spot else None,
        esql=spot['EQSL'] if 'EQSL' in spot else None,
        dx_homecall=spot['DXHomecall'],
        comment=spot['Comment'],
        flag=spot.get('Flag'),
        band=str(spot['Band']),
        mode=spot['Mode'],
        missing_mode=missing_mode,
        continent_dx=spot.get('Continent_dx'),
        continent_spotter=spot['Continent_spotter'],
        dx_locator=spot['DXLocator']
    )

    return record


async def get_dxheat_spots_per_band(band:str, limit:int=30, debug:bool=False) -> list|None:
    # assert isinstance(band, int)
    # assert isinstance(limit, int)
    limit = min(50, limit)
    
    url = f"https://dxheat.com/source/spots/?a={limit}&b={band}&cdx=EU&cdx=NA&cdx=SA&cdx=AS&cdx=AF&cdx=OC&cdx=AN&cde=EU&cde=NA&cde=SA&cde=AS&cde=AF&cde=OC&cde=AN&m=CW&m=PHONE&m=DIGI&valid=1&spam=0"
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=15)
    if debug:
        logger.debug(f"{response.content}")

    # Check if request was successful
    if response.status_code == 200:
        if debug:
            logger.debug(f"band={band}, limit={limit}")
        # Parse JSON string to a Python list
        spots = []
        for spot in json.loads(response.content):
            if debug:
                logger.debug(f"spot={spot}")
            spots.append(spot)
        return spots
    else:
        return []


async def collect_dxheat_spots(debug=False):
    bands = [160, 80, 60, 40, 30, 20, 17, 15, 12, 10, 6, 4, "SHF", "UHF", "VHF", "LF"]
    start = time()
    tasks = []
    for band in bands:
        task = asyncio.create_task(get_dxheat_spots_per_band(band=band, limit=30))
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


async def push_spots_to_db(spot_records: list[DxheatRaw], debug: bool = False):
    logger.info(f"Attempting to push {len(spot_records)} spot records to the database.")
    engine = create_async_engine(POSTGRES_DB_URL, echo=debug)
    async with AsyncSession(engine) as session:
        # Convert DxheatRaw objects to dictionaries for bulk insert
        records_data = []
        for record in spot_records:
            record_dict = {k: v for k, v in record.__dict__.items() if not k.startswith('_')}
            records_data.append(record_dict)

        # Construct the insert statement with ON CONFLICT DO NOTHING
        insert_stmt = insert(DxheatRaw).values(records_data)
        on_conflict_stmt = insert_stmt.on_conflict_do_nothing(
            index_elements=["date", "time", "spotter",  "frequency", "dx_call"] # Specify the unique index columns
        )

        try:
            await session.execute(on_conflict_stmt)
            await session.commit()
            logger.info(f"Successfully pushed {len(spot_records)} spot records (duplicates ignored).")
        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to push spot records to database: {e}")
    await engine.dispose()


async def main(debug=False):
    while True:
        start = time()
        logger.info(f"Start collection")
        spot_records = await collect_dxheat_spots(debug=debug)
        
        if spot_records: # Only push if there are records
            await push_spots_to_db(spot_records=spot_records, debug=debug)
        else:
            logger.info("No new spot records to push to database.")

        end = time()
        if debug:
            logger.debug(f"Elasped time: {end - start:.2f} seconds")
        sleep(60)


if __name__ == "__main__":
    debug = string_to_boolean(DEBUG)
    # if debug:
    log_file_path = open_log_file(log_filename_prefix="collectors/logs/web_collectors/dxheat", debug=debug)
    logger.info(f"DEBUG is {debug}")
    asyncio.run(main(debug=debug))

    # Manual compression
    if debug and log_file_path and os.path.exists(log_file_path):
        zip_file_path = log_file_path + ".zip"
        try:
            with zipfile.ZipFile(zip_file_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                zipf.write(log_file_path, os.path.basename(log_file_path))
            logger.info(f"Log file compressed to: {zip_file_path}")
            os.remove(log_file_path) # Delete original log file
            logger.info(f"Original log file deleted: {log_file_path}")
        except Exception as e:
            logger.error(f"Error compressing log file: {e}")

