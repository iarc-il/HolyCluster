import json
from loguru import logger
import httpx


async def get_dxheat_spots(band, limit=30, debug=False):

    assert isinstance(band, int)
    assert isinstance(limit, int)
    limit = min(50,limit)

    url = f"https://dxheat.com/source/spots/?a={limit}&b={band}&cdx=EU&cdx=NA&cdx=SA&cdx=AS&cdx=AF&cdx=OC&cdx=AN&cde=EU&cde=NA&cde=SA&cde=AS&cde=AF&cde=OC&cde=AN&m=CW&m=PHONE&valid=1&spam=0"
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
    if debug:
        logger.debug(f"{response.content}")

    # Check if request was successful
    if response.status_code == 200:
        if debug:
            logger.debug(f"band={band}, limit={limit}")
        # Parse JSON string to a Python list
        spots = []
        for spot in json.loads(response.content):
            if debug:
                logger.debug(f"spot={spot}")
            spots.append(spot)
        return spots
    else:
        return []

