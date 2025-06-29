from time import time
import sys
from pathlib import Path
from loguru import logger
import asyncio

grandparent_folder = Path(__file__).parents[2] # 2 directories up
sys.path.append(f"{grandparent_folder}")
from src.spots_collector import get_dxheat_spots

async def main(debug=False):
    bands = [10, 12, 15, 17, 20, 40, 80, 160]
    start =time()
    tasks = []
    for band in bands:
        task = asyncio.create_task(get_dxheat_spots(band=band, limit=5))
        tasks.append(task)
    all_spots = await asyncio.gather(*tasks)
    if debug:
        logger.debug(f"all_spots=\n{all_spots}")
    end =time()
    if debug:
        logger.debug(f"Elasped time: {end - start :.2f} seconds")


if __name__ == '__main__':
    debug=True
    asyncio.run(main(debug=debug))
