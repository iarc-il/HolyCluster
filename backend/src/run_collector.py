from time import time
import sys
from pathlib import Path
from loguru import logger
import asyncio
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.exc import ProgrammingError, OperationalError

import settings
from db_classes import DxheatRaw
from spots_collector import get_dxheat_spots, prepare_dxheat_record, prepare_holy_spot
from qrz import get_qrz_session_key


# 2 directories up
grandparent_folder = Path(__file__).parents[1]
sys.path.append(f"{grandparent_folder}")


async def collect_dxheat_spots(debug=False):
    bands = [160, 80, 40, 30, 20, 17, 15, 12, 10, 6]
    start = time()
    tasks = []
    for band in bands:
        task = asyncio.create_task(get_dxheat_spots(band=band, limit=300))
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
    holy_spot_records = []

    qrz_session_key = get_qrz_session_key(username=settings.QRZ_USER, password=settings.QRZ_PASSOWRD, api_key=settings.QRZ_API_KEY)

    # Create a configured "Session" class
    Session = sessionmaker(bind=engine)

    # Create a Session
    session = Session()

    with engine.connect() as connection:
        connection.execution_options(isolation_level="AUTOCOMMIT")  # Set isolation level to autocommit
        try:
            # DX Heat
            spot_records = await collect_dxheat_spots(debug=debug)
            for record in spot_records:
                existing_spot = session.query(DxheatRaw).filter_by(number=record.number).first()
                if existing_spot is None:
                    session.add(record)
                    if  record.valid:
                        holy_spot_record = prepare_holy_spot(
                            date=record.date,
                            time=record.time,
                            mode=record.mode,
                            band=record.band,
                            frequency=record.frequency,
                            spotter_callsign=record.dx_call,
                            dx_callsign=record.dx_homecall,
                            dx_locator=record.dx_locator,
                            qrz_session_key=qrz_session_key,
                            debug=debug
                        )
                        holy_spot_records.append(holy_spot_record)


            session.commit()

            # DX Lite
            # TBD

        except (ProgrammingError, OperationalError) as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    debug = True
    asyncio.run(main(debug=debug))
