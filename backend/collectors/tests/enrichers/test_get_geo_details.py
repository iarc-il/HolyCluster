import asyncio
import sys
from pathlib import Path

from loguru import logger

sys.path.insert(0, str(Path(__file__).parents[3]))

from collectors.db.valkey_config import get_valkey_client
from collectors.settings import settings
from shared.geo import get_geo_details
from shared.qrz import get_qrz_session_key


async def main(callsign: str):
    qrz_session_key = get_qrz_session_key(
        username=settings.qrz_user, password=settings.qrz_password, api_key=settings.qrz_api_key
    )
    valkey_client = get_valkey_client()

    (
        geo_cache,
        locator_source,
        locator,
        lat,
        lon,
        country,
        continent,
    ) = await get_geo_details(
        valkey_client, qrz_session_key, callsign, settings.valkey_geo_expiration, http_client=None
    )
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
