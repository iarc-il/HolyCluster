from datetime import datetime
import os
import json
import asyncio
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
import redis

from misc import open_log_file
from db.valkey_config import get_valkey_client

from settings import (
    DEBUG,
    VALKEY_HOST,
    VALKEY_PORT,
    VALKEY_DB,
    POSTGRES_DB_URL,
)

from postgres_classes import HolySpot2

global valkey_client
valkey_client = get_valkey_client(host=VALKEY_HOST, port=VALKEY_PORT, db=VALKEY_DB)


async def convert_spot_to_record(spot: dict, debug: bool = False):
    dt = datetime.strptime(spot["date_time"], "%Y-%m-%d %H:%M:%S%z")
    dt_naive = dt.replace(tzinfo=None)
    record = HolySpot2(
        cluster=spot["cluster"],
        time=dt.time(),
        date_time=dt_naive,
        frequency=spot["frequency"],
        band=spot["band"],
        mode=spot["mode"],
        mode_selection=spot["mode_selection"],
        spotter_callsign=spot["spotter_callsign"],
        spotter_locator=spot["spotter_locator"],
        spotter_locator_source=spot["spotter_locator_source"],
        spotter_lat=spot["spotter_lat"],
        spotter_lon=spot["spotter_lon"],
        spotter_country=spot["spotter_country"],
        spotter_continent=spot["spotter_continent"],
        dx_callsign=spot["dx_callsign"],
        dx_locator=spot["dx_locator"],
        dx_locator_source=spot["dx_locator_source"],
        dx_lat=spot["dx_lat"],
        dx_lon=spot["dx_lon"],
        dx_country=spot["dx_country"],
        dx_continent=spot["dx_continent"],
        comment=spot["comment"],
    )

    return record


async def add_spot_to_postgres(spot: dict, debug: bool = False):
    if debug:
        logger.debug("Attempting to add spot records to the database.")

    record = await convert_spot_to_record(spot=spot, debug=debug)
    engine = create_async_engine(POSTGRES_DB_URL, echo=debug)

    async with AsyncSession(engine) as session:
        session.add(record)
        await session.commit()
        await session.refresh(record)
        logger.debug(f"{record.id=}")
        logger.info("Successfully pushed spot record (duplicates ignored).")

    await engine.dispose()


async def postgres_spots_consumer(debug: bool = False):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    log_filename = "add_enrich_telnet_spots"
    log_dir = os.path.join(script_dir, "..", "..", "logs")
    os.makedirs(log_dir, exist_ok=True)
    telnet_log_dir = os.path.join(log_dir, "db")
    os.makedirs(telnet_log_dir, exist_ok=True)
    log_path = os.path.join(telnet_log_dir, log_filename)
    open_log_file(log_filename_prefix=log_path, debug=debug)
    logger.info("spots_consumer started")

    STREAM_NAME = "stream-postres"
    CONSUMER_GROUP = "postres-group"
    CONSUMER_NAME = "consumer_1"

    # Create consumer group (only first time)
    try:
        valkey_client.xgroup_create(STREAM_NAME, CONSUMER_GROUP, id="0", mkstream=True)
    except redis.exceptions.ResponseError:
        # Group already exists
        pass

    last_id = ">"

    while True:
        # Block until a message arrives
        resp = valkey_client.xreadgroup(
            CONSUMER_GROUP, CONSUMER_NAME, {STREAM_NAME: last_id}, count=10, block=60000
        )
        if not resp:
            continue

        for stream_name, messages in resp:
            for msg_id, spot in messages:
                if debug:
                    logger.debug(f"{msg_id=}")
                    logger.debug(f"spot={json.dumps(spot, indent=4)}")
                valkey_client.xack(STREAM_NAME, CONSUMER_GROUP, msg_id)
                valkey_client.xtrim(STREAM_NAME, minid=msg_id, approximate=False)

                # add spot to postgres
                logger.info(f"{spot=}")
                await add_spot_to_postgres(spot=spot, debug=debug)


if __name__ == "__main__":
    asyncio.run(postgres_spots_consumer(debug=DEBUG))
