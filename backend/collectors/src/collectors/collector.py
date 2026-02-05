import argparse
import asyncio
import sys
from datetime import datetime, timezone

from loguru import logger
from shared.db import HolySpot
from shared.geo import GeoException
from shared.qrz import QrzSessionManager
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from collectors.db.valkey_config import get_valkey_client
from collectors.enrichers.dxpeditions import is_active_dxpedition
from collectors.enrichers.frequencies import find_band_and_mode
from collectors.enrichers.geo import get_geo_details
from collectors.settings import settings
from collectors.telnet_collectors.run_telnet_collectors import (
    run_concurrent_telnet_connections,
)

STREAM_API = "stream-api"


async def enrich_spot(qrz_session_key: str, spot: dict) -> dict:
    spot["timestamp"] = datetime.now(timezone.utc).timestamp()

    band_mode = find_band_and_mode(frequency=spot["frequency"], comment=spot["comment"])
    if band_mode is None:
        logger.debug(f"Dropping spot due to invalid band: {spot}")
        return None

    band, mode, mode_selection = band_mode
    spot.update({"band": band, "mode": mode, "mode_selection": mode_selection})

    spotter_geo = await get_geo_details(qrz_session_key=qrz_session_key, callsign=spot["spotter_callsign"])
    dx_geo = await get_geo_details(qrz_session_key=qrz_session_key, callsign=spot["dx_callsign"])

    spot.update(
        {
            # Redis doesn't except bools
            "spotter_geo_cache": 1 if spotter_geo.cached else 0,
            "spotter_locator_source": spotter_geo.locator_source,
            "spotter_locator": spotter_geo.locator,
            "spotter_lat": spotter_geo.lat,
            "spotter_lon": spotter_geo.lon,
            "spotter_country": spotter_geo.country,
            "spotter_continent": spotter_geo.continent,
            "spotter_state": spotter_geo.state,
            # Redis doesn't except bools
            "dx_geo_cache": 1 if dx_geo.cached else 0,
            "dx_locator_source": dx_geo.locator_source,
            "dx_locator": dx_geo.locator,
            "dx_lat": dx_geo.lat,
            "dx_lon": dx_geo.lon,
            "dx_country": dx_geo.country,
            "dx_continent": dx_geo.continent,
            "dx_state": dx_geo.state,
        }
    )

    spot.update(
        {
            "is_dxpedition": 1 if is_active_dxpedition(spot["dx_callsign"]) else 0,
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
        spotter_state=spot["spotter_state"],
        dx_callsign=spot["dx_callsign"],
        dx_locator=spot["dx_locator"],
        dx_locator_source=spot["dx_locator_source"],
        dx_lat=str(spot["dx_lat"]),
        dx_lon=str(spot["dx_lon"]),
        dx_country=spot["dx_country"],
        dx_continent=spot["dx_continent"],
        dx_state=spot["dx_state"],
        comment=spot["comment"],
        is_dxpedition=spot["is_dxpedition"],
    )

    async with AsyncSession(engine) as session:
        session.add(record)
        await session.commit()


async def process_spots(input_queue: asyncio.Queue, qrz_manager: QrzSessionManager):
    logger.info("Spot processor started")

    valkey_client = get_valkey_client(
        host=settings.valkey_effective_host, port=settings.valkey_effective_port, db=settings.valkey_db
    )
    engine = create_async_engine(settings.db_url)

    try:
        while True:
            spot = await input_queue.get()

            try:
                enriched_spot = await enrich_spot(qrz_session_key=qrz_manager.get_key(), spot=spot)
            except GeoException:
                logger.exception("Dropping spot due to geo exception")
                continue

            if enriched_spot is None:
                logger.info(f"Dropping spot: {spot}")
                input_queue.task_done()
                continue
            else:
                logger.info(f"Enriched: {enriched_spot.get('dx_callsign')} on {enriched_spot.get('frequency')}")

                await add_spot_to_postgres(engine, enriched_spot)

                if all(enriched_spot.get(k) for k in ("spotter_locator", "dx_locator", "band", "mode")):
                    await valkey_client.xadd(STREAM_API, enriched_spot, "*")
            input_queue.task_done()

    except asyncio.CancelledError:
        logger.info("Spot processor cancelled")
    finally:
        await engine.dispose()


async def refresh_dxpedition_data(valkey_client):
    from collectors.enrichers.dxpeditions import refresh_dxpedition_cache

    while True:
        sleep = 86400
        try:
            await refresh_dxpedition_cache(redis_client=valkey_client)
            logger.info("DXpedition data refreshed successfully")
        except Exception:
            sleep = 600
            logger.exception("Failed to refresh DXpedition data")
        await asyncio.sleep(sleep)


async def run_collector():
    logger.info("Starting collector...")

    spots_queue: asyncio.Queue = asyncio.Queue()

    valkey_client = get_valkey_client(
        host=settings.valkey_effective_host, port=settings.valkey_effective_port, db=settings.valkey_db
    )

    qrz_manager = QrzSessionManager(
        username=settings.qrz_user,
        password=settings.qrz_password,
        api_key=settings.qrz_api_key,
        refresh_interval=settings.qrz_session_key_refresh,
        redis_client=valkey_client,
    )
    await qrz_manager.start()

    qrz_refresh_task = asyncio.create_task(qrz_manager.refresh_loop(), name="qrz_refresh_task")
    dxpedition_refresh_task = asyncio.create_task(
        refresh_dxpedition_data(valkey_client), name="dxpedition_refresh_task"
    )
    processor_task = asyncio.create_task(process_spots(spots_queue, qrz_manager), name="processor_task")
    collector_task = asyncio.create_task(run_concurrent_telnet_connections(spots_queue), name="collector_task")

    tasks = [qrz_refresh_task, dxpedition_refresh_task, processor_task, collector_task]
    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        logger.info("Collector shutting down...")


async def run_collector_wrapper():
    import aiomonitor
    loop = asyncio.get_running_loop()
    with aiomonitor.start_monitor(loop):
        await run_collector()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    if not args.verbose:
        logger.remove()
        logger.add(sys.stdout, level="INFO")

    asyncio.run(run_collector_wrapper())


if __name__ == "__main__":
    main()
