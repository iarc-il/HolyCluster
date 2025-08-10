import sys
from pathlib import Path
# Add project root and src root to the path to allow direct imports
project_root = Path(__file__).resolve().parents[3]
src_root = Path(__file__).resolve().parents[1]
sys.path.append(str(project_root))
sys.path.append(str(src_root))

import asyncio
from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.exc import SQLAlchemyError, ProgrammingError, OperationalError

from db_classes import Base
import settings
from misc import string_to_boolean, open_log_file

from settings import (
    DEBUG,
    POSTGRES_DB_URL,
)

async def check_database_exists(connection, db_name):
    result = await connection.execute(text(f"SELECT 1 FROM pg_database WHERE datname='{db_name}'"))
    return result.scalar() is not None


async def drop_database_if_exists(connection, db_name):
    if await check_database_exists(connection=connection, db_name=db_name):
        await connection.execute(text(f'DROP DATABASE {db_name} WITH (FORCE);'))
        logger.info(f'Database "{db_name}" dropped successfully.')
    else:
        logger.info(f'Database "{db_name}" does not exist.')


async def create_new_database(connection, db_name):
    await connection.execute(text(f'CREATE DATABASE {db_name}'))
    logger.info(f'Database "{db_name}" created successfully.')


async def create_tables(engine):
    logger.info('Creating tables')
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info('Tables created successfully')
    except SQLAlchemyError as e:
        logger.error(f'Error creating tables: {e}')


async def main(debug: bool = False):
    try:
        # Create an engine connected to the default database ('postgres')
        # NOTE: The database name in the URL is ignored for the initial connection to drop/create.
        # We connect to the default 'postgres' db to perform these operations.
        engine = create_async_engine(POSTGRES_DB_URL.rsplit('/', 1)[0] + '/postgres', echo=debug)

        async with engine.connect() as connection:
            await connection.execution_options(isolation_level="AUTOCOMMIT")
            try:
                db_name = settings.POSTGRES_DB
                logger.info(f"Dropping database {db_name}")
                await drop_database_if_exists(connection=connection, db_name=db_name)
                logger.info(f"Creating database {db_name}")
                await create_new_database(connection=connection, db_name=db_name)
            except (ProgrammingError, OperationalError) as e:
                logger.error(f'Error: {e}')

        # Dispose of the old engine
        await engine.dispose()

        # Now, connect to the newly created database to create tables
        engine = create_async_engine(POSTGRES_DB_URL, echo=debug)
        await create_tables(engine=engine)
        await engine.dispose()
    except OSError as e:
        logger.error("Could not connect to the database. Please ensure it is running and accessible.")
        logger.error(f"Underlying error: {e}")


if __name__ == "__main__":
    if string_to_boolean(DEBUG):
        logger.info("DEBUG is True")
        open_log_file("logs/init_pg") # Corrected typo in log file name
    else:
        logger.info("DEBUG is False")
    asyncio.run(main(debug=string_to_boolean(DEBUG)))
