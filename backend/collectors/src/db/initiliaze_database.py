from loguru import logger
from sqlalchemy import create_engine, text
from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError, ProgrammingError, OperationalError

from db_classes import Base
import settings
from misc import string_to_boolean, open_log_file

from settings import (
    DEBUG, 
    GENERAL_DB_URL,
)

def check_database_exists(connection, db_name):
    result = connection.execute(text(f"SELECT 1 FROM pg_database WHERE datname='{db_name}'"))
    return result.scalar() is not None


def drop_database_if_exists(connection, db_name):
    if check_database_exists(connection=connection, db_name=db_name):
        connection.execute(text(f'DROP DATABASE {db_name} WITH (FORCE);'))
        logger.info(f'Database "{db_name}" dropped successfully.')
    else:
        logger.info(f'Database "{db_name}" does not exist.')


def create_new_database(connection, db_name):
    connection.execute(text(f'CREATE DATABASE {db_name}'))
    logger.info(f'Database "{db_name}" created successfully.')


def create_tables(engine, tables):
    logger.info('Creating tables')

    try:
        # Create the table in the database
        Base.metadata.create_all(engine)
        logger.info('Tables created successfully')
        # Confirm table creation
        inspector = inspect(engine)
        table_names = inspector.get_table_names()
        for table in tables:
            if table in table_names:
                logger.info(f'Table {table} confirmed created')
            else:
                logger.error(f'Table {table} not found after creation attempt')

    except SQLAlchemyError as e:
        logger.error(f'Error creating tables: {e}')


def main(debug: bool = False):
    # Create an engine connected to the default database
    engine = create_engine(f"{GENERAL_DB_URL}/postgres", echo=True)

    # Connect to the database and drop the target database if it exists, then create new database, then create tables
    with engine.connect() as connection:
        connection.execution_options(isolation_level="AUTOCOMMIT")  # Set isolation level to autocommit
        try:
            logger.info(f"Dropping database {settings.DATABASE}")
            drop_database_if_exists(connection=connection, db_name=settings.DATABASE)
            logger.info(f"Creating database {settings.DATABASE}")
            create_new_database(connection=connection, db_name=settings.DATABASE)

        except (ProgrammingError, OperationalError) as e:
            logger.error(f'Error: {e}')

    engine = create_engine(settings.DB_URL, echo=True)

    tables = ['dxheat_raw', 'holy_spots', 'geo_cache', 'spots_with_issues']
    with engine.connect() as connection:
        connection.execution_options(isolation_level="AUTOCOMMIT")  # Set isolation level to autocommit
        try:
            create_tables(engine=engine, tables=tables)

        except (ProgrammingError, OperationalError) as e:
            print(f'Error: {e}')


if __name__ == "__main__":
    if string_to_boolean(DEBUG):
        logger.info("DEBUG is True")
        open_log_file("logs/initiliaze_datasbe")
    else:
        logger.info("DEBUG is False")
    main(debug=string_to_boolean(DEBUG))
