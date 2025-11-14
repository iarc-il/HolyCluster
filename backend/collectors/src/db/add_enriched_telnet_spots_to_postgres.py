import argparse
import os
import time
import re
import json
import asyncio
from loguru import logger

from collectors.src.misc import open_log_file
from collectors.src.db.valkey_config import get_valkey_client

from collectors.src.settings import (
    DEBUG,
    VALKEY_HOST,
    VALKEY_PORT,
    VALKEY_DB,
)

global valkey_client
valkey_client = get_valkey_client(host=VALKEY_HOST, port=VALKEY_PORT, db=VALKEY_DB)

async def postgres_spots_consumer(debug: bool = False):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    log_filename = f"add_enrich_telnet_spots"
    log_dir = os.path.join(script_dir, '..', '..', 'logs')
    os.makedirs(log_dir, exist_ok=True)
    telnet_log_dir = os.path.join(log_dir, 'db')
    os.makedirs(telnet_log_dir, exist_ok=True)
    log_path = os.path.join(telnet_log_dir, log_filename)
    open_log_file(log_filename_prefix=log_path, debug=debug)
    logger.info(f"spots_consumer started")

    STREAM_NAME = "stream-postres"
    CONSUMER_GROUP = "postres-group"
    CONSUMER_NAME = "consumer_1"
# Create consumer group (only first time)
    try:
        valkey_client.xgroup_create(STREAM_NAME, CONSUMER_GROUP, id='0', mkstream=True)
    except redis.exceptions.ResponseError:
        # Group already exists
        pass

    last_id = '>'

    while True:
        try:
            # Block until a message arrives
            resp = valkey_client.xreadgroup(CONSUMER_GROUP, CONSUMER_NAME, {STREAM_NAME: last_id}, count=10, block=5000)
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
                    
                    

        except Exception as ex:
            message = f"**** ERROR postress_spots_consumer **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
            logger.error(message)

if __name__ == "__main__":
    asyncio.run(postgres_spots_consumer(debug=DEBUG))

