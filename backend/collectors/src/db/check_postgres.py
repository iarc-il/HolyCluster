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


async def main(debug: bool = False, initialize: bool = False):
    try:
        db_name = settings.POSTGRES_DB
        engine = create_async_engine(POSTGRES_DB_URL.rsplit('/', 1)[0] + '/postgres', echo=debug)

        db_exists = False
        async with engine.connect() as connection:
            db_exists = await check_database_exists(connection, db_name)

        if initialize:
            logger.info("Initialization flag set. Forcing drop and recreate of database.")
            async with engine.connect() as connection:
                await connection.execution_options(isolation_level="AUTOCOMMIT")
                await drop_database_if_exists(connection, db_name)
                await create_new_database(connection, db_name)
            
            await engine.dispose()
            new_db_engine = create_async_engine(POSTGRES_DB_URL, echo=debug)
            await create_tables(engine=new_db_engine)
            await new_db_engine.dispose()
            logger.info("Database initialization complete.")

        elif not db_exists:
            logger.info(f"Database '{db_name}' does not exist. Creating it now.")
            async with engine.connect() as connection:
                await connection.execution_options(isolation_level="AUTOCOMMIT")
                await create_new_database(connection, db_name)
            
            await engine.dispose()
            new_db_engine = create_async_engine(POSTGRES_DB_URL, echo=debug)
            await create_tables(engine=new_db_engine)
            await new_db_engine.dispose()
            logger.info("Database creation complete.")

        else:
            logger.info(f"Database '{db_name}' already exists. No action taken.")
            await engine.dispose()

    except OSError as e:
        logger.error("Could not connect to the database. Please ensure it is running and accessible.")
        logger.error(f"Underlying error: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Check or initialize the PostgreSQL database.")
    parser.add_argument("--init", action="store_true", help="Drop and recreate the database and tables.")
    args = parser.parse_args()

    if string_to_boolean(DEBUG):
        logger.info("DEBUG is True")
        open_log_file("collectors/logs/init_postgres")
    else:
        logger.info("DEBUG is False")
    
    asyncio.run(main(debug=string_to_boolean(DEBUG), initialize=args.init))
