from time import time
import sys
from pathlib import Path
from loguru import logger
import asyncio
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError, ProgrammingError, OperationalError

from settings import (
    PSQL_USERNAME,
    PSQL_PASSWORD,
)

grandparent_folder = Path(__file__).parents[1] # 2 directories up
sys.path.append(f"{grandparent_folder}")
from src.spots_collector import get_dxheat_spots, prepare_dxheat_record



async def collect_dxheat_spots(debug=False):
    bands = [20,40]
    start =time()
    tasks = []
    for band in bands:
        task = asyncio.create_task(get_dxheat_spots(band=band, limit=5))
        tasks.append(task)
    all_spots = await asyncio.gather(*tasks)
    if debug:
        logger.debug(f"all_spots=\n{all_spots}")
    end =time()
    if debug:
        logger.debug(f"Elasped time: {end - start :.2f} seconds")

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


def db_details():
    user = PSQL_USERNAME
    password =PSQL_PASSWORD
    host = 'localhost'
    port = '5432'
    database = 'holly_cluster'

    return user, password, host, port, database


async def main(debug=False):
    # get databse details
    user, password, host, port, database = db_details()
    # Create an engine connected to the default database
    engine = create_engine(f'postgresql+psycopg2://{user}:{password}@{host}:{port}/{database}', echo=True)

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
                session.add(record)
            session.commit()

            # DX Lite
            # TBD

        except (ProgrammingError, OperationalError) as e:
            print(f'Error: {e}')



if __name__ == '__main__':
    debug=True
    asyncio.run(main(debug=debug))
