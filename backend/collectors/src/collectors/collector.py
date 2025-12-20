import asyncio
from datetime import datetime, timezone
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from collectors.db.valkey_config import get_valkey_client
from collectors.enrichers.frequencies import find_band_and_mode
from collectors.enrichers.geo import get_geo_details
from shared.qrz import QrzSessionManager
from collectors.telnet_collectors.run_telnet_collectors import (
    run_concurrent_telnet_connections,
)

from collectors.settings import (
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


def get_timestamp(time_str: str):
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


async def enrich_spot(qrz_session_key: str, spot: dict) -> dict:
    timestamp = get_timestamp(time_str=spot["time"])
    spot["timestamp"] = timestamp

    band_mode = find_band_and_mode(frequency=spot["frequency"], comment=spot["comment"])
    if band_mode is None:
        logger.debug(f"Dropping spot due to invalid band: {spot}")
        return None

    band, mode, mode_selection = band_mode
    spot.update({"band": band, "mode": mode, "mode_selection": mode_selection})

    (
        spotter_geo_cache,
        spotter_locator_source,
        spotter_locator,
        spotter_lat,
        spotter_lon,
        spotter_country,
        spotter_continent,
    ) = await get_geo_details(qrz_session_key=qrz_session_key, callsign=spot["spotter_callsign"])

    (
        dx_geo_cache,
        dx_locator_source,
        dx_locator,
        dx_lat,
        dx_lon,
        dx_country,
        dx_continent,
    ) = await get_geo_details(qrz_session_key=qrz_session_key, callsign=spot["dx_callsign"])

    spot.update(
        {
            "spotter_geo_cache": spotter_geo_cache,
            "spotter_locator_source": spotter_locator_source or "",
            "spotter_locator": spotter_locator or "",
            "spotter_lat": spotter_lat,
            "spotter_lon": spotter_lon,
            "spotter_country": spotter_country or "",
            "spotter_continent": spotter_continent or "",
            "dx_geo_cache": dx_geo_cache,
            "dx_locator_source": dx_locator_source or "",
            "dx_locator": dx_locator or "",
            "dx_lat": dx_lat,
            "dx_lon": dx_lon,
            "dx_country": dx_country or "",
            "dx_continent": dx_continent or "",
        }
    )

    return spot


async def add_spot_to_postgres(engine, spot: dict):
    """Add an enriched spot to PostgreSQL."""
    dt = datetime.fromtimestamp(float(spot["timestamp"]))
    record = HolySpot(
        cluster=spot["cluster"],
        time=dt.time(),
        timestamp=int(float(spot["timestamp"])),
        frequency=str(spot["frequency"]),
        band=spot["band"],
        mode=spot["mode"],
        mode_selection=spot["mode_selection"],
        spotter_callsign=spot["spotter_callsign"],
        spotter_locator=spot["spotter_locator"],
        spotter_locator_source=spot["spotter_locator_source"],
        spotter_lat=str(spot["spotter_lat"]),
        spotter_lon=str(spot["spotter_lon"]),
        spotter_country=spot["spotter_country"],
        spotter_continent=spot["spotter_continent"],
        dx_callsign=spot["dx_callsign"],
        dx_locator=spot["dx_locator"],
        dx_locator_source=spot["dx_locator_source"],
        dx_lat=str(spot["dx_lat"]),
        dx_lon=str(spot["dx_lon"]),
        dx_country=spot["dx_country"],
        dx_continent=spot["dx_continent"],
        comment=spot["comment"],
    )

    async with AsyncSession(engine) as session:
        session.add(record)
        await session.commit()


async def process_spots(input_queue: asyncio.Queue, qrz_manager: QrzSessionManager):
    logger.info("Spot processor started")

    valkey_client = get_valkey_client(host=VALKEY_HOST, port=VALKEY_PORT, db=VALKEY_DB)
    engine = create_async_engine(POSTGRES_DB_URL)

    try:
        while True:
            spot = await input_queue.get()

            try:
                enriched_spot = await enrich_spot(qrz_session_key=qrz_manager.get_key(), spot=spot)
                if enriched_spot is None:
                    logger.info(f"Dropping spot: {spot}")
                    input_queue.task_done()
                    continue
                logger.info(f"Enriched: {enriched_spot.get('dx_callsign')} on {enriched_spot.get('frequency')}")

                await add_spot_to_postgres(engine, enriched_spot)

                if all(enriched_spot.get(k) for k in ("spotter_locator", "dx_locator", "band", "mode")):
                    await valkey_client.xadd(STREAM_API, enriched_spot, "*")
                input_queue.task_done()

            except Exception:
                logger.exception("Error processing spot")
                input_queue.task_done()

    except asyncio.CancelledError:
        logger.info("Spot processor cancelled")
    finally:
        await engine.dispose()


async def run_collector():
    logger.info("Starting collector...")

    spots_queue: asyncio.Queue = asyncio.Queue()

    qrz_manager = QrzSessionManager(
        username=QRZ_USER,
        password=QRZ_PASSOWRD,
        api_key=QRZ_API_KEY,
        refresh_interval=QRZ_SESSION_KEY_REFRESH,
    )
    await qrz_manager.start()

    qrz_refresh_task = asyncio.create_task(qrz_manager.refresh_loop())
    processor_task = asyncio.create_task(process_spots(spots_queue, qrz_manager))
    collector_task = asyncio.create_task(run_concurrent_telnet_connections(spots_queue))

    try:
        await asyncio.gather(qrz_refresh_task, processor_task, collector_task)
    except asyncio.CancelledError:
        logger.info("Collector shutting down...")
        qrz_refresh_task.cancel()
        processor_task.cancel()
        collector_task.cancel()
        await asyncio.gather(qrz_refresh_task, processor_task, collector_task, return_exceptions=True)


def main():
    asyncio.run(run_collector())


if __name__ == "__main__":
    main()
