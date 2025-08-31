import sys
from pathlib import Path
import asyncio
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.exc import ProgrammingError, OperationalError

# Add project root to sys.path
sys.path.append(str(Path(__file__).parents[3]))

from db_classes import GeoCache
from settings import POSTGRES_DB_URL as DB_URL, DEBUG
from misc import string_to_boolean


async def get_geo_cache_from_db(session, callsign: str, debug: bool = False):
    result = await session.execute(select(GeoCache).where(GeoCache.callsign == callsign))
    return result.scalar_one_or_none()


async def main(debug: bool = False):
    engine = create_async_engine(DB_URL, echo=debug)
    AsyncSession = async_sessionmaker(bind=engine)

    async with AsyncSession() as session:
        try:
            callsign = "A1BCD"  # Example callsign
            logger.info(f"Querying for callsign: {callsign}")
            spot = await get_geo_cache_from_db(session=session, callsign=callsign, debug=debug)
            if spot:
                logger.info(f"Found spot: {spot}")
            else:
                logger.info(f"Spot not found for callsign: {callsign}")

        except (ProgrammingError, OperationalError) as e:
            logger.error(f"Database error: {e}")
        except Exception as e:
            logger.error(f"Unexpected error: {e}")


if __name__ == "__main__":
    debug = string_to_boolean(DEBUG)
    if debug:
        logger.info("DEBUG is True")
    else:
        logger.info("DEBUG is False")
    asyncio.run(main(debug=debug))