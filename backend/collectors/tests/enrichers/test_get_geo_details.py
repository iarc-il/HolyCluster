import sys
import asyncio
from pathlib import Path
from loguru import logger

sys.path.insert(0, str(Path(__file__).parents[3]))

# grandparent_folder = Path(__file__).parents[2] # 2 directories up
# sys.path.append(f"{grandparent_folder}")

from collectors.src.enrichers.geo import get_geo_details

async def main(callsign: str, debug: bool = False):
    geo_cache, locator_source, locator,lat, lon, country, continent = await get_geo_details(callsign=callsign, debug=debug)
    logger.debug(f"{geo_cache=}")
    logger.debug(f"{locator_source=}")
    logger.debug(f"{locator=}")
    logger.debug(f"{lat=}")
    logger.debug(f"{lon=}")
    logger.debug(f"{country=}")
    logger.debug(f"{continent=}")


if __name__ == "__main__":
    debug = True
    callsign = '4X5BR'
    asyncio.run(main(callsign=callsign, debug=debug))

