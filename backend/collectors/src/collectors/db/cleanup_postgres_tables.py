import asyncio
import os
from datetime import UTC, datetime, timedelta

from loguru import logger
from shared.db import GeoCache, HolySpot
from sqlalchemy import delete, func, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from collectors.logging_setup import open_log_file
from collectors.settings import settings


async def cleanup(debug: bool = False):
    open_log_file(os.path.join(settings.log_dir, "collectors", "db", "cleanup_database"))
    engine = create_async_engine(settings.db_url, echo=False)
    AsyncSession = async_sessionmaker(bind=engine)

    hours = 24 * settings.postgres_db_retention_days
    now_utc = datetime.now(UTC)
    cutoff_datetime = (now_utc - timedelta(hours=hours)).replace(tzinfo=None)
    logger.info(f"Delete records older than {hours} hours")
    logger.info(f"now (UTC)             = {now_utc.replace(tzinfo=None)}")
    logger.info(f"cutoff_datetime (UTC) = {cutoff_datetime}")

    tables = [["holy_spots2", HolySpot], ["geo_cache", GeoCache]]

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


def main():
    asyncio.run(cleanup())


if __name__ == "__main__":
    main()
