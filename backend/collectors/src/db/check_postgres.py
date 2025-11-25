import sys
from pathlib import Path
# Add project root and src root to the path to allow direct imports
project_root = Path(__file__).resolve().parents[3]
src_root = Path(__file__).resolve().parents[1]
sys.path.append(str(project_root))
sys.path.append(str(src_root))

import argparse
import asyncio
from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.exc import SQLAlchemyError, ProgrammingError, OperationalError
from sqlmodel import SQLModel, create_engine

from postgres_classes2 import HolySpot2, SpotsWithIssues2 
from misc import open_log_file, in_docker

from settings import (
    DEBUG,
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_HOST,
    POSTGRES_HOST_LOCAL,
    POSTGRES_PORT,
    POSTGRES_PORT_LOCAL,
    POSTGRES_DB_NAME,
    POSTGRES_DB_URL,
)
if not in_docker():
    POSTGRES_HOST = POSTGRES_HOST_LOCAL
    POSTGRES_PORT = POSTGRES_PORT_LOCAL


async def check_database_exists(connection, db_name):
    try:
        result = await connection.execute(text(f"SELECT 1 FROM pg_database WHERE datname='{db_name}'"))
        return result.scalar() is not None
    except Exception as ex:
        message = f"**** ERROR {sys._getframe(0).f_code.co_name} **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)
        


async def drop_database_if_exists(connection, db_name):
    try:
        if await check_database_exists(connection=connection, db_name=db_name):
            await connection.execute(text(f'DROP DATABASE {db_name} WITH (FORCE);'))
            logger.info(f'Database "{db_name}" dropped successfully.')
        else:
            logger.info(f'Database "{db_name}" does not exist.')
    except Exception as ex:
        message = f"**** ERROR {sys._getframe(0).f_code.co_name}  **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)


async def create_new_database(connection, db_name):
    try:
        await connection.execute(text(f'CREATE DATABASE {db_name}'))
        logger.info(f'Database "{db_name}" created successfully.')
    except Exception as ex:
        message = f"**** ERROR {sys._getframe(0).f_code.co_name}  **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)


async def main(args, debug: bool = False
):
    initialize = args.init
    host = args.host if args.host is not None else POSTGRES_HOST
    port = args.port if args.port is not None else POSTGRES_PORT
    POSTGRES_GENERAL_DB_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{host}:{port}"
    POSTGRES_DB_URL = f"{POSTGRES_GENERAL_DB_URL}/{POSTGRES_DB_NAME}"
    engine_name = POSTGRES_GENERAL_DB_URL + '/postgres'
    if debug:
        logger.debug(f"{POSTGRES_USER=}")
        logger.debug(f"{POSTGRES_HOST=}")
        logger.debug(f"{host=}")
        logger.debug(f"{POSTGRES_PORT=}")
        logger.debug(f"{port=}")
        logger.debug(f"{POSTGRES_DB_NAME=}")
        logger.debug(f"{POSTGRES_GENERAL_DB_URL=}")
        logger.debug(f"{POSTGRES_DB_URL=}")
        logger.debug(f"{engine_name=}")
    engine = create_async_engine(engine_name, echo=debug)

    db_exists = False
    async with engine.connect() as connection:
        db_exists = await check_database_exists(connection, POSTGRES_DB_NAME)

    if initialize:
        logger.info("Initialization flag set. Forcing drop and recreate of database.")
        async with engine.connect() as connection:
            await connection.execution_options(isolation_level="AUTOCOMMIT")
            await drop_database_if_exists(connection, POSTGRES_DB_NAME)
            await create_new_database(connection, POSTGRES_DB_NAME)

        await engine.dispose()
        if debug:
            logger.debug(f"Creating tables")
        new_db_engine = create_async_engine(POSTGRES_DB_URL, echo=debug)
        async with new_db_engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        await new_db_engine.dispose()
        logger.info("Database initialization complete.")

    elif not db_exists:
        logger.info(f"Database '{POSTGRES_DB_NAME}' does not exist. Creating it now.")
        async with engine.connect() as connection:
            await connection.execution_options(isolation_level="AUTOCOMMIT")
            await create_new_database(connection, POSTGRES_DB_NAME)

        await engine.dispose()
        if debug:
            logger.debug(f"Creating tables")
        new_db_engine = create_async_engine(POSTGRES_DB_URL, echo=debug)
        async with new_db_engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        await new_db_engine.dispose()
        logger.info("Database initialization complete.")

    else:
        logger.info(f"Database '{POSTGRES_DB_NAME}' already exists. No action taken.")
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Check or initialize the PostgreSQL database.")
    parser.add_argument("--init", action="store_true", help="Drop and recreate the database and tables.")
    parser.add_argument("-d","--debug", action="store_true", default=False, help="Debug mode")
    parser.add_argument("--host", type=str, required=False, help="hostname")
    parser.add_argument("--port", type=str, required=False, help="port")
    args = parser.parse_args()
    open_log_file("collectors/logs/db/check_postgres")
    debug = args.debug if args.debug else  DEBUG
    logger.info(f"{debug=}")
    if debug:
        logger.debug(f"{args=}")
    
    asyncio.run(main(args=args, debug=debug))
