import asyncio
import time
import json
from datetime import datetime
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from collectors.db.valkey_config import get_valkey_client
from collectors.enrichers.frequencies import find_band_and_mode
from collectors.enrichers.geo import get_geo_details
from collectors.enrichers.qrz import get_qrz_session_key
from collectors.telnet_collectors.run_telnet_collectors import run_concurrent_telnet_connections

from collectors.settings import (
    DEBUG,
    VALKEY_HOST,
    VALKEY_PORT,
    VALKEY_DB,
    POSTGRES_DB_URL,
    QRZ_USER,
    QRZ_PASSOWRD,
    QRZ_API_KEY,
    QRZ_SESSION_KEY_REFRESH,
)

from db import HolySpot


STREAM_API = "stream-api"


def get_timestamp(time_str: str, debug: bool = False):
    try:
        from datetime import timezone
        now_utc = datetime.now(timezone.utc)
        timestamp = (
            datetime.now(timezone.utc)
            .replace(
                hour=int(time_str[:2]),
                minute=int(time_str[2:4]),
                second=now_utc.second,
                microsecond=now_utc.microsecond,
            )
            .timestamp()
        )
        return timestamp
    except Exception as ex:
        logger.error(f"get_timestamp error: {type(ex).__name__}: {ex.args}")
        return None


async def enrich_spot(qrz_session_key: str, spot: dict, debug: bool = False) -> dict:
    try:
        timestamp = get_timestamp(time_str=spot["time"], debug=debug)
        spot["timestamp"] = timestamp

        band, mode, mode_selection = find_band_and_mode(
            frequency=spot["frequency"], comment=spot["comment"], debug=debug
        )
        spot.update({"band": band, "mode": mode, "mode_selection": mode_selection})

        (
            spotter_geo_cache,
            spotter_locator_source,
            spotter_locator,
            spotter_lat,
            spotter_lon,
            spotter_country,
            spotter_continent,
        ) = await get_geo_details(qrz_session_key=qrz_session_key, callsign=spot["spotter_callsign"], debug=debug)

        (
            dx_geo_cache,
            dx_locator_source,
            dx_locator,
            dx_lat,
            dx_lon,
            dx_country,
            dx_continent,
        ) = await get_geo_details(qrz_session_key=qrz_session_key, callsign=spot["dx_callsign"], debug=debug)

        spot.update({
            "spotter_geo_cache": spotter_geo_cache,
            "spotter_locator_source": spotter_locator_source,
            "spotter_locator": spotter_locator,
            "spotter_lat": spotter_lat,
            "spotter_lon": spotter_lon,
            "spotter_country": spotter_country,
            "spotter_continent": spotter_continent,
            "dx_geo_cache": dx_geo_cache,
            "dx_locator_source": dx_locator_source,
            "dx_locator": dx_locator,
            "dx_lat": dx_lat,
            "dx_lon": dx_lon,
            "dx_country": dx_country,
            "dx_continent": dx_continent,
        })

        if debug:
            logger.debug(f"Enriched spot: {json.dumps(spot, indent=2)}")

        return spot

    except Exception as ex:
        logger.error(f"enrich_spot error: {type(ex).__name__}: {ex.args}")
        return spot


async def add_spot_to_postgres(engine, spot: dict, debug: bool = False):
    """Add an enriched spot to PostgreSQL."""
    try:
        dt = datetime.fromtimestamp(float(spot["timestamp"]))
        record = HolySpot(
            cluster=spot["cluster"],
            time=dt.time(),
            timestamp=int(float(spot["timestamp"])),
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

        async with AsyncSession(engine) as session:
            session.add(record)
            await session.commit()
            if debug:
                await session.refresh(record)
                logger.debug(f"Spot saved to DB: {record.id}")

    except Exception as ex:
        logger.exception(f"Failed to add spot to DB: {ex}")


async def process_spots(input_queue: asyncio.Queue, debug: bool = False):
    logger.info("Spot processor started")

    valkey_client = get_valkey_client(host=VALKEY_HOST, port=VALKEY_PORT, db=VALKEY_DB)
    engine = create_async_engine(POSTGRES_DB_URL, echo=debug)

    qrz_session_key = get_qrz_session_key(username=QRZ_USER, password=QRZ_PASSOWRD, api_key=QRZ_API_KEY)
    last_qrz_refresh = time.time()

    try:
        while True:
            now = time.time()
            if now - last_qrz_refresh >= QRZ_SESSION_KEY_REFRESH:
                logger.info(f"Refreshing QRZ key (every {QRZ_SESSION_KEY_REFRESH} seconds)")
                await asyncio.sleep(5)
                qrz_session_key = get_qrz_session_key(username=QRZ_USER, password=QRZ_PASSOWRD, api_key=QRZ_API_KEY)
                last_qrz_refresh = now

            try:
                spot = await asyncio.wait_for(input_queue.get(), timeout=5.0)
            except asyncio.TimeoutError:
                continue

            try:
                enriched_spot = await enrich_spot(qrz_session_key=qrz_session_key, spot=spot, debug=debug)
                logger.info(f"Enriched: {enriched_spot.get('dx_callsign')} on {enriched_spot.get('frequency')}")

                await add_spot_to_postgres(engine, enriched_spot, debug=debug)

                if all(enriched_spot.get(k) for k in ("spotter_locator", "dx_locator", "band", "mode")):
                    valkey_client.xadd(STREAM_API, enriched_spot, "*")
                    if debug:
                        logger.debug(f"Published to {STREAM_API}")

                input_queue.task_done()

            except Exception as ex:
                logger.exception(f"Error processing spot: {ex}")

    except asyncio.CancelledError:
        logger.info("Spot processor cancelled")
    finally:
        await engine.dispose()


async def run_collector(debug: bool = False):
    logger.info("Starting collector...")

    spots_queue: asyncio.Queue = asyncio.Queue()

    processor_task = asyncio.create_task(process_spots(spots_queue, debug=debug))
    collector_task = asyncio.create_task(run_concurrent_telnet_connections(spots_queue, debug=debug))

    try:
        await asyncio.gather(processor_task, collector_task)
    except asyncio.CancelledError:
        logger.info("Collector shutting down...")
        processor_task.cancel()
        collector_task.cancel()
        await asyncio.gather(processor_task, collector_task, return_exceptions=True)


def main():
    print(f"{DEBUG=}")
    asyncio.run(run_collector(debug=DEBUG))


if __name__ == "__main__":
    main()

