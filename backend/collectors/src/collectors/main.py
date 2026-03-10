import argparse
import asyncio
import sys
import re
from datetime import datetime, timezone

from loguru import logger
from shared.db import HolySpot
from shared.geo import GeoException, get_geo_details
from shared.metrics import push_drop_event, push_exception_event, set_timestamp
from shared.qrz import QrzSessionManager
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from collectors.db.valkey_config import get_valkey_client
from collectors.enrichers.dxpeditions import is_active_dxpedition
from collectors.enrichers.frequencies import InvalidBandError, find_band_and_mode
from collectors.settings import settings
from collectors.telnet.runner import (
    run_concurrent_telnet_connections,
)

import aiomonitor

STREAM_API = "stream-api"


class InvalidCallsignError(Exception):
    pass


# Not a perfect validation, but it filters out many useless requests to QRZ.
def validate_callsign(callsign, role):
    has_number = re.search(r"\d", callsign) is not None
    has_letter = re.search(r"[a-zA-Z]", callsign) is not None
    if not (has_number and has_letter):
        raise InvalidCallsignError(f"Invalid {role} callsign: {callsign}")


async def enrich_spot(qrz_session_key: str, spot: dict, http_client, valkey_client) -> dict:
    spot["timestamp"] = datetime.now(timezone.utc).timestamp()

    band, mode, mode_selection = find_band_and_mode(frequency=spot["frequency"], comment=spot["comment"])

    validate_callsign(spot["spotter_callsign"], "spotter")
    validate_callsign(spot["dx_callsign"], "dx")

    spotter_geo, dx_geo = await asyncio.gather(
        get_geo_details(
            valkey_client,
            qrz_session_key,
            spot["spotter_callsign"],
            settings.valkey_geo_expiration,
            http_client,
            "spotter",
        ),
        get_geo_details(
            valkey_client,
            qrz_session_key,
            spot["dx_callsign"],
            settings.valkey_geo_expiration,
            http_client,
            "dx_callsign",
        ),
    )

    spot.update(
        {
            "band": band,
            "mode": mode,
            "mode_selection": mode_selection,
            "is_dxpedition": 1 if is_active_dxpedition(spot["dx_callsign"]) else 0,
            # Redis doesn't accept bools
            "spotter_geo_cache": 1 if spotter_geo.cached else 0,
            "spotter_locator_source": spotter_geo.locator_source,
            "spotter_locator": spotter_geo.locator,
            "spotter_lat": spotter_geo.lat,
            "spotter_lon": spotter_geo.lon,
            "spotter_country": spotter_geo.country,
            "spotter_continent": spotter_geo.continent,
            "spotter_state": spotter_geo.state,
            # Redis doesn't accept bools
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

    valkey_client = get_valkey_client()
    engine = create_async_engine(settings.db_url, pool_recycle=3600)

    try:
        while True:
            spot = await input_queue.get()
            await set_timestamp(valkey_client, "collector:heartbeat")
            try:
                try:
                    enriched_spot = await enrich_spot(
                        qrz_session_key=qrz_manager.get_key(),
                        spot=spot,
                        http_client=qrz_manager.http_client,
                        valkey_client=valkey_client,
                    )
                except InvalidBandError:
                    logger.debug(f"Dropping spot due to invalid band: {spot}")
                    await push_drop_event(valkey_client, "invalid_band", str(spot))
                    continue
                except InvalidCallsignError as e:
                    logger.info(f"Dropping spot due to {e}: {spot}")
                    continue
                except GeoException as e:
                    logger.exception("Dropping spot due to geo exception")
                    await push_drop_event(
                        valkey_client, f"geo_exception ({e.callsign_type}, {e.data_type})", e.callsign
                    )
                    continue
                except Exception as e:
                    logger.exception("Unexpected error enriching spot")
                    await push_exception_event(valkey_client, "collector", str(e))
                    continue

                logger.debug(f"Enriched: {enriched_spot.get('dx_callsign')} on {enriched_spot.get('frequency')}")

                if enriched_spot["spotter_locator"].startswith("AA00") or enriched_spot["dx_locator"].startswith(
                    "AA00"
                ):
                    logger.info(f"Dropping spot with South Pole locator: {enriched_spot.get('dx_callsign')}")
                    continue

                await add_spot_to_postgres(engine, enriched_spot)
                await set_timestamp(valkey_client, "collector:last_spot_time")

                if all(enriched_spot.get(k) for k in ("spotter_locator", "dx_locator", "band", "mode")):
                    await valkey_client.xadd(STREAM_API, enriched_spot, "*", maxlen=10000)
            finally:
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
        except Exception as e:
            sleep = 600
            logger.exception("Failed to refresh DXpedition data")
            await push_exception_event(valkey_client, "collector", f"dxpedition refresh: {e}")
        await asyncio.sleep(sleep)


async def run_collector():
    logger.info("Starting collector...")

    spots_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)

    valkey_client = get_valkey_client()

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
    collector_tasks = run_concurrent_telnet_connections(spots_queue)

    tasks = [qrz_refresh_task, dxpedition_refresh_task, processor_task]
    tasks.extend(collector_tasks)

    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        logger.info("Collector shutting down...")


async def run_collector_with_monitor():
    loop = asyncio.get_running_loop()
    with aiomonitor.start_monitor(loop):
        await run_collector()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    if not args.verbose:
        logger.remove()
        logger.add(sys.stdout, level="INFO", filter=lambda record: "task" not in record["extra"])

    asyncio.run(run_collector_with_monitor())


if __name__ == "__main__":
    main()
