import asyncio
import sys
from pathlib import Path

from loguru import logger

sys.path.insert(0, str(Path(__file__).parents[3]))

# grandparent_folder = Path(__file__).parents[2] # 2 directories up
# sys.path.append(f"{grandparent_folder}")

from collectors.enrichers.geo import get_geo_details
from collectors.settings import settings
from shared.qrz import get_qrz_session_key


async def main(callsign: str):
    qrz_session_key = get_qrz_session_key(
        username=settings.qrz_user, password=settings.qrz_password, api_key=settings.qrz_api_key
    )

    (
        geo_cache,
        locator_source,
        locator,
        lat,
        lon,
        country,
        continent,
    ) = await get_geo_details(qrz_session_key=qrz_session_key, callsign=callsign)
    logger.debug(f"{geo_cache=}")
    logger.debug(f"{locator_source=}")
    logger.debug(f"{locator=}")
    logger.debug(f"{lat=}")
    logger.debug(f"{lon=}")
    logger.debug(f"{country=}")
    logger.debug(f"{continent=}")


if __name__ == "__main__":
    callsign = "4X5BR/P"
    asyncio.run(main(callsign=callsign))
