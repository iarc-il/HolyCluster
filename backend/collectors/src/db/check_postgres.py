import sys
import argparse
import asyncio
from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from postgres_classes import Base
from misc import open_log_file

from settings import (
    DEBUG,
    POSTGRES_DB_NAME,
    POSTGRES_GENERAL_DB_URL,
    POSTGRES_DB_URL,
)


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
            await connection.execute(text(f"DROP DATABASE {db_name} WITH (FORCE);"))
            logger.info(f'Database "{db_name}" dropped successfully.')
        else:
            logger.info(f'Database "{db_name}" does not exist.')
    except Exception as ex:
        message = f"**** ERROR {sys._getframe(0).f_code.co_name}  **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)


async def create_new_database(connection, db_name):
    try:
        await connection.execute(text(f"CREATE DATABASE {db_name}"))
        logger.info(f'Database "{db_name}" created successfully.')
    except Exception as ex:
        message = f"**** ERROR {sys._getframe(0).f_code.co_name}  **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)


async def main(args, debug: bool = False):
    initialize = args.init
    engine_name = POSTGRES_GENERAL_DB_URL + "/postgres"
    if debug:
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
            logger.debug("Creating tables")
        new_db_engine = create_async_engine(POSTGRES_DB_URL, echo=debug)
        async with new_db_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await new_db_engine.dispose()
        logger.info("Database initialization complete.")

    elif not db_exists:
        logger.info(f"Database '{POSTGRES_DB_NAME}' does not exist. Creating it now.")
        async with engine.connect() as connection:
            await connection.execution_options(isolation_level="AUTOCOMMIT")
            await create_new_database(connection, POSTGRES_DB_NAME)

        await engine.dispose()
        if debug:
            logger.debug("Creating tables")
        new_db_engine = create_async_engine(POSTGRES_DB_URL, echo=debug)
        async with new_db_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await new_db_engine.dispose()
        logger.info("Database initialization complete.")

    else:
        logger.info(f"Database '{POSTGRES_DB_NAME}' already exists. No action taken.")
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Check or initialize the PostgreSQL database.")
    parser.add_argument("--init", action="store_true", help="Drop and recreate the database and tables.")
    parser.add_argument("-d", "--debug", action="store_true", default=False, help="Debug mode")
    args = parser.parse_args()
    open_log_file("collectors/logs/db/check_postgres")
    debug = args.debug if args.debug else DEBUG
    logger.info(f"{debug=}")
    if debug:
        logger.debug(f"{args=}")

    asyncio.run(main(args=args, debug=debug))
