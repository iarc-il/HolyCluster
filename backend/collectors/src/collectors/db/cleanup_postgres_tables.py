import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent))
import asyncio
from datetime import datetime, timedelta, timezone, UTC
from loguru import logger
from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.exc import SQLAlchemyError, ProgrammingError, OperationalError

from db import GeoCache, HolySpot
from misc import string_to_boolean, open_log_file

from settings import (
    DEBUG,
    POSTGRES_DB_URL,
    POSTGRES_DB_RETENTION_DAYS,
)


async def main(debug: bool = False):
    open_log_file("logs/cleanup_database")
    engine = create_async_engine(POSTGRES_DB_URL, echo=False)
    AsyncSession = async_sessionmaker(bind=engine)

    hours = 24 * POSTGRES_DB_RETENTION_DAYS
    now_utc = datetime.now(UTC)
    cutoff_datetime = (now_utc - timedelta(hours=hours)).replace(tzinfo=None)
    logger.info(f"Delete records older than {hours} hours")
    logger.info(f"now (UTC)             = {now_utc.replace(tzinfo=None)}")
    logger.info(f"cutoff_datetime (UTC) = {cutoff_datetime}")

    tables = [
        ["holy_spots2", HolySpot],
        ["geo_cache", GeoCache]
    ]

    try:
        async with AsyncSession() as session:
            for item in tables:
                table_name = item[0]
                model = item[1]
                
                async with session.begin():
                    result = await session.execute(select(func.count()).select_from(model))
                    record_count = result.scalar_one()
                    logger.info(f"Before cleanup: Table: {table_name:12}   records: {record_count}")

                    delete_stmt = delete(model).where(model.date_time < cutoff_datetime)
                    delete_result = await session.execute(delete_stmt)
                    deleted_count = delete_result.rowcount

                    if debug:
                        logger.debug(f"Deleted {deleted_count} records from {table_name}")

                    result = await session.execute(select(func.count()).select_from(model))
                    record_count = result.scalar_one()
                    logger.info(f"After  cleanup: Table: {table_name:12}   records: {record_count}")

    except (ProgrammingError, OperationalError) as e:
        logger.error(f"Database error: {e}")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")


if __name__ == "__main__":
    if string_to_boolean(DEBUG):
        logger.info("DEBUG is True")
        open_log_file("logs/db/cleanup")
    else:
        logger.info("DEBUG is False")
    asyncio.run(main(debug=string_to_boolean(DEBUG)))
