import asyncio
import json
import re
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum

import fastapi
import httpx
import redis.asyncio
from fastapi import HTTPException, Query, websockets
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from shared.cty import ensure_cty_available
from shared.db import GeoCache, HolySpot, PropagationMeasurement, SpotsWithIssues
from shared.geo import GeoException, get_geo_details
from shared.metrics import push_exception_event, set_timestamp, set_value
from shared.telemetry import capture_exception, initialize_sentry
from sqlalchemy import desc, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import select

from . import propagation, releases, submit_spot, voacap
from .settings import settings

initialize_sentry(settings, "api")


def build_propagation_measurement_rows(history, collected_at):
    rows = []
    for metric, samples in history.items():
        for sample in samples:
            value = sample.get("value")
            timestamp = sample.get("timestamp")
            if value is None or timestamp is None:
                continue

            rows.append(
                {
                    "metric": metric,
                    "timestamp": int(timestamp),
                    "value": float(value),
                    "collected_at": collected_at,
                }
            )
    return rows


async def upsert_propagation_history(history):
    rows = build_propagation_measurement_rows(history, datetime.now(UTC).replace(tzinfo=None))
    if not rows:
        return 0

    statement = pg_insert(PropagationMeasurement.__table__).values(rows)
    statement = statement.on_conflict_do_update(
        index_elements=["metric", "timestamp"],
        set_={
            "value": statement.excluded.value,
            "collected_at": statement.excluded.collected_at,
        },
    )

    async with async_session() as session:
        await session.execute(statement)
        await session.commit()

    return len(rows)


async def propagation_data_collector(app):
    while True:
        sleep = 3600
        try:
            propagation_history = await propagation.collect_propagation_history()
            app.state.propagation = propagation.latest_propagation_from_history(propagation_history)
            app.state.propagation["time"] = int(time.time())
            logger.info(f"Got propagation data: {app.state.propagation}")

            try:
                stored_samples = await upsert_propagation_history(propagation_history)
                logger.info(f"Stored {stored_samples} propagation samples")
            except Exception as e:
                sleep = 10
                logger.exception(f"Failed to persist propagation data: {str(e)}")
                capture_exception(e)
                await push_exception_event(app.state.valkey_client, "api", f"propagation persist: {e}")
        except Exception as e:
            sleep = 10
            logger.exception(f"Failed to fetch propagation data: {str(e)}")
            capture_exception(e)
            await push_exception_event(app.state.valkey_client, "api", f"propagation: {e}")
        await asyncio.sleep(sleep)


async def send_json_to_websockets(websockets, message):
    disconnected = set()
    for websocket in websockets.copy():
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.warning(f"Failed to send to websocket: {e}")
            disconnected.add(websocket)

    for websocket in disconnected:
        websockets.discard(websocket)


async def broadcast_spots(app, spots):
    await send_json_to_websockets(app.state.active_connections, {"type": "update", "spots": spots})
    await send_json_to_websockets(
        app.state.active_ws_spot_connections,
        build_ws_message(WsMessageType.SPOTS, event=WsSpotEvent.UPDATE.value, spots=spots),
    )


async def spots_broadcast_task(app):
    STREAM_NAME = "stream-api"
    CONSUMER_GROUP = "api-group"
    CONSUMER_NAME = "consumer_1"

    valkey_client = redis.asyncio.Redis(
        host=settings.valkey_effective_host,
        port=settings.valkey_effective_port,
        db=0,
        decode_responses=True,
    )

    try:
        await valkey_client.xgroup_create(STREAM_NAME, CONSUMER_GROUP, id="0", mkstream=True)
    except redis.exceptions.ResponseError:
        pass

    while True:
        await set_timestamp(valkey_client, "api:heartbeat")

        response = await valkey_client.xreadgroup(
            CONSUMER_GROUP, CONSUMER_NAME, {STREAM_NAME: ">"}, count=10, block=60000
        )
        if not response:
            continue

        try:
            for stream_name, messages in response:
                spots = []
                for msg_id, spot in messages:
                    await valkey_client.xack(STREAM_NAME, CONSUMER_GROUP, msg_id)
                    await valkey_client.xtrim(STREAM_NAME, minid=msg_id, approximate=False)

                    spot = cleanup_spot(spot)
                    if spot is not None:
                        spots.append(spot)

                await broadcast_spots(app, spots)

                await set_timestamp(valkey_client, "api:last_broadcast_time")
                await set_value(
                    valkey_client,
                    "api:ws_clients",
                    len(app.state.active_connections) + len(app.state.active_ws_spot_connections),
                )

        except Exception as e:
            logger.exception(f"Error in spots broadcast task: {e}")
            capture_exception(e)
            await push_exception_event(valkey_client, "api", f"broadcast: {e}")


@asynccontextmanager
async def lifespan(app: fastapi.FastAPI):
    if not settings.ui_dist_path.is_dir():
        raise RuntimeError(f"UI directory does not exist: {settings.ui_dist_path}")

    app.state.active_connections = set()
    app.state.active_ws_spot_connections = set()
    app.state.propagation = None

    app.state.valkey_client = redis.asyncio.Redis(
        host=settings.valkey_effective_host,
        port=settings.valkey_effective_port,
        db=int(settings.valkey_db),
        decode_responses=True,
    )

    app.state.http_client = httpx.AsyncClient()

    await ensure_cty_available(http_client=app.state.http_client)

    tasks = [
        asyncio.create_task(propagation_data_collector(app)),
        asyncio.create_task(spots_broadcast_task(app)),
    ]

    yield

    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks)
    await app.state.http_client.aclose()
    await app.state.valkey_client.aclose()


engine = create_async_engine(
    settings.db_url,
    pool_size=10,
    max_overflow=20,
    pool_timeout=30,
    pool_pre_ping=True,
    pool_recycle=3600,
)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

app = fastapi.FastAPI(lifespan=lifespan, openapi_url=None, docs_url=None, redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1000)

MISSING_RESOLVE_RESULT_BATCH_SIZE = 50
MISSING_RESOLVE_WORKER_COUNT = 4
MISSING_CALLSIGN_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9/]{0,31}$")
PROPAGATION_METRICS = ("a_index", "k_index", "sfi")
MAX_PROPAGATION_HISTORY_RANGE_SECONDS = 86400
PROPAGATION_BUCKET_SECONDS = 1800
WS_PROTOCOL_VERSION = 1


class WsErrorType(StrEnum):
    MALFORMED_MESSAGE = "MalformedMessage"
    MISSING_VERSION = "MissingVersion"
    MISSING_FIELD = "MissingField"
    UNSUPPORTED_ACTION = "UnsupportedAction"
    UNSUPPORTED_VERSION = "UnsupportedVersion"
    NOT_IMPLEMENTED = "NotImplemented"
    UNKNOWN_JOB = "UnknownJob"


class WsMessageType(StrEnum):
    SPOTS = "spots"
    SUBMIT = "submit"
    RADIO = "radio"
    MISSING = "missing"
    HISTORY = "history"


class WsSpotAction(StrEnum):
    INITIAL = "initial"
    CATCH_UP = "catch_up"


class WsSpotEvent(StrEnum):
    INITIAL = "initial"
    UPDATE = "update"


class WsRadioEvent(StrEnum):
    STATUS = "status"


class WsHistoryEvent(StrEnum):
    SPOTS = "spots"
    PROPAGATION = "propagation"


class WsMissingAction(StrEnum):
    START = "start"
    ADD = "add"
    FINISH = "finish"


class WsMissingEvent(StrEnum):
    ACCEPTED = "accepted"
    RESULTS = "results"
    COMPLETE = "complete"


def build_ws_error(error_type: WsErrorType, message: str, **data):
    response = {
        "version": WS_PROTOCOL_VERSION,
        "type": "error",
        "error_type": error_type.value,
        "message": message,
    }
    response.update(data)
    return response


def build_ws_message(message_type: WsMessageType, **data):
    response = {
        "version": WS_PROTOCOL_VERSION,
        "type": message_type.value,
    }
    response.update(data)
    return response


def validate_ws_protocol_message(message):
    if not isinstance(message, dict):
        return build_ws_error(WsErrorType.MALFORMED_MESSAGE, "WebSocket message must be a JSON object")

    if "version" not in message:
        return build_ws_error(WsErrorType.MISSING_VERSION, "Missing websocket protocol version")

    if message["version"] != WS_PROTOCOL_VERSION:
        return build_ws_error(
            WsErrorType.UNSUPPORTED_VERSION,
            "Unsupported websocket protocol version",
            received_version=message["version"],
        )

    return None


def build_propagation_history_response(start_time, end_time, range_samples, previous_samples):
    metrics = {metric: [] for metric in PROPAGATION_METRICS}
    samples = sorted(
        [*previous_samples, *range_samples],
        key=lambda sample: (sample.timestamp, sample.metric),
    )

    for sample in samples:
        metrics.setdefault(sample.metric, []).append(
            {
                "timestamp": sample.timestamp,
                "value": sample.value,
            }
        )

    return {
        "start_time": start_time,
        "end_time": end_time,
        "metrics": metrics,
    }


async def get_propagation_history_data(start_time, end_time):
    async with async_session() as session:
        range_query = (
            select(PropagationMeasurement)
            .where(PropagationMeasurement.metric.in_(PROPAGATION_METRICS))
            .where(PropagationMeasurement.timestamp >= start_time)
            .where(PropagationMeasurement.timestamp <= end_time)
            .order_by(PropagationMeasurement.timestamp, PropagationMeasurement.metric)
        )
        range_samples = (await session.execute(range_query)).scalars().all()

        previous_sample_ids = (
            select(
                PropagationMeasurement.id,
                func.row_number()
                .over(
                    partition_by=PropagationMeasurement.metric,
                    order_by=desc(PropagationMeasurement.timestamp),
                )
                .label("row_number"),
            )
            .where(PropagationMeasurement.metric.in_(PROPAGATION_METRICS))
            .where(PropagationMeasurement.timestamp < start_time)
            .subquery()
        )
        previous_query = (
            select(PropagationMeasurement)
            .join(previous_sample_ids, PropagationMeasurement.id == previous_sample_ids.c.id)
            .where(previous_sample_ids.c.row_number == 1)
            .order_by(PropagationMeasurement.timestamp, PropagationMeasurement.metric)
        )
        previous_samples = (await session.execute(previous_query)).scalars().all()

    return build_propagation_history_response(start_time, end_time, range_samples, previous_samples)


def propagation_bucket_start(timestamp):
    return (timestamp // PROPAGATION_BUCKET_SECONDS) * PROPAGATION_BUCKET_SECONDS


def bucket_propagation_history(history):
    start_time = history["start_time"]
    end_time = history["end_time"]
    first_bucket_start = propagation_bucket_start(start_time)
    last_bucket_start = propagation_bucket_start(max(end_time - 1, start_time))
    bucket_centers = [
        b + PROPAGATION_BUCKET_SECONDS // 2
        for b in range(first_bucket_start, last_bucket_start + PROPAGATION_BUCKET_SECONDS, PROPAGATION_BUCKET_SECONDS)
    ]

    bucketed_metrics = {}
    for metric in PROPAGATION_METRICS:
        samples = history["metrics"].get(metric, [])
        idx = 0
        latest_value = None
        bucket_values = []
        for center in bucket_centers:
            while idx < len(samples) and samples[idx]["timestamp"] <= center:
                latest_value = samples[idx]["value"]
                idx += 1
            if latest_value is not None:
                bucket_values.append({"timestamp": center, "value": latest_value})
        bucketed_metrics[metric] = bucket_values

    return {
        "start_time": first_bucket_start,
        "end_time": last_bucket_start + PROPAGATION_BUCKET_SECONDS,
        "metrics": bucketed_metrics,
    }


@dataclass
class MissingWsJob:
    job_id: str
    callsigns: list[str] = field(default_factory=list)
    seen_callsigns: set[str] = field(default_factory=set)
    errors: dict[str, str] = field(default_factory=dict)
    task: asyncio.Task | None = None


def cleanup_spot(spot):
    try:
        if spot["mode"].upper() in ("SSB", "USB", "LSB"):
            mode = "SSB"
        else:
            mode = spot["mode"].upper()

        if spot["band"].upper() not in ("VHF", "UHF", "SHF"):
            band = float(spot["band"])
        else:
            band = spot["band"]

        cleaned_spot = {
            "spotter_callsign": spot["spotter_callsign"],
            "spotter_loc": [float(spot["spotter_lon"]), float(spot["spotter_lat"])],
            "spotter_dxcc_code": int(spot["spotter_dxcc_code"]),
            "spotter_continent": spot["spotter_continent"],
            "spotter_state": spot.get("spotter_state"),
            "spotter_cq_zone": int(spot.get("spotter_cq_zone") or -1),
            "spotter_itu_zone": int(spot.get("spotter_itu_zone") or -1),
            "dx_callsign": spot["dx_callsign"],
            "dx_loc": [float(spot["dx_lon"]), float(spot["dx_lat"])],
            "dx_dxcc_code": int(spot["dx_dxcc_code"]),
            "dx_continent": spot["dx_continent"],
            "dx_state": spot.get("dx_state"),
            "dx_cq_zone": int(spot.get("dx_cq_zone") or -1),
            "dx_itu_zone": int(spot.get("dx_itu_zone") or -1),
            "freq": float(spot["frequency"]),
            "band": band,
            "mode": mode,
            "time": float(spot["timestamp"]),
            "comment": spot["comment"],
            "is_dxpedition": bool(int(spot.get("is_dxpedition", 0))),
        }
        if spot.get("dx_lotw_status") is not None:
            cleaned_spot["dx_lotw_status"] = spot["dx_lotw_status"]
        spot_type = spot.get("type")
        if not spot_type and spot.get("cluster") == "pota.app":
            spot_type = "pota"
        if not spot_type and spot.get("cluster") == "spots.wwff.co":
            spot_type = "wwff"
        if not spot_type and spot.get("cluster") == "sota":
            spot_type = "sota"
        if spot_type:
            cleaned_spot["type"] = spot_type
        for key in ("pota_reference", "pota_name", "pota_description"):
            value = spot.get(key)
            if value is not None:
                cleaned_spot[key] = value
        sota_points = spot.get("sota_points")
        if sota_points is not None:
            cleaned_spot["sota_points"] = int(sota_points)
        return cleaned_spot
    except (KeyError, ValueError):
        logger.exception(f"Failed to process spot: {spot}")
        return None


def cleanup_spots(spots):
    spots = [cleanup_spot(dict(spot)) for spot in spots]
    spots = [spot for spot in spots if spot is not None]
    return spots


async def get_qrz_session_key_from_redis() -> str:
    qrz_key = await app.state.valkey_client.get("qrz:session_key")
    if not qrz_key:
        raise HTTPException(status_code=503, detail="QRZ session key not available")
    return qrz_key


def normalize_missing_callsigns(callsigns):
    normalized_callsigns = []
    errors = {}
    seen_callsigns = set()

    for callsign in callsigns:
        if not isinstance(callsign, str):
            errors[str(callsign)] = "invalid callsign"
            continue
        normalized = callsign.strip().upper()
        if not MISSING_CALLSIGN_PATTERN.fullmatch(normalized):
            errors[normalized] = "invalid callsign"
            continue
        if normalized in seen_callsigns:
            continue
        seen_callsigns.add(normalized)
        normalized_callsigns.append(normalized)

    return normalized_callsigns, errors


async def get_missing_qrz_session_key():
    try:
        return await get_qrz_session_key_from_redis()
    except Exception as e:
        logger.warning(f"QRZ session key unavailable for missing resolve; continuing with CTY fallback: {e}")
        return ""


def build_missing_geo_result(callsign, geo_data):
    return {
        "callsign": callsign,
        "dxcc_code": geo_data.dxcc_code,
        "continent": geo_data.continent,
        "state": geo_data.state,
        "cq_zone": geo_data.cq_zone,
        "itu_zone": geo_data.itu_zone,
        "locator": geo_data.locator,
        "lat": geo_data.lat,
        "lon": geo_data.lon,
        "source": "cache" if geo_data.cached else geo_data.locator_source,
    }


async def resolve_missing_callsign(callsign, qrz_session_key):
    geo_data = await get_geo_details(
        app.state.valkey_client,
        qrz_session_key,
        callsign,
        settings.valkey_geo_expiration,
        app.state.http_client,
        "missing_import",
    )
    return build_missing_geo_result(callsign, geo_data)


async def compute_cluster_stats(valkey_client, hours: int | None = None):
    if hours is not None:
        min_id = str(int((time.time() - hours * 3600) * 1000))
    else:
        min_id = "-"

    entries = await valkey_client.xrange("stream-arrivals", min=min_id, max="+")

    spot_sources = defaultdict(set)

    for entry_id, fields in entries:
        cluster = fields["cluster"]
        cluster = cluster.split(":")[0]
        spot_key = fields["spot_key"]
        ts_ms = int(entry_id.split("-")[0])
        day = ts_ms // 86_400_000
        spot_sources[(day, spot_key)].add(cluster)

    cluster_totals = defaultdict(int)
    cluster_exclusive = defaultdict(int)
    pairwise_overlap = defaultdict(lambda: defaultdict(int))

    for (_day, _spot_key), clusters in spot_sources.items():
        for c in clusters:
            cluster_totals[c] += 1
        if len(clusters) == 1:
            cluster_exclusive[next(iter(clusters))] += 1
        else:
            cluster_list = sorted(clusters)
            for i, c1 in enumerate(cluster_list):
                for c2 in cluster_list[i + 1 :]:
                    pairwise_overlap[c1][c2] += 1
                    pairwise_overlap[c2][c1] += 1

    all_clusters = sorted(cluster_totals.keys())

    if hours is not None:
        period_hours = hours
    elif entries:
        earliest_ms = int(entries[0][0].split("-")[0])
        period_hours = round((time.time() * 1000 - earliest_ms) / 3_600_000, 1)
    else:
        period_hours = 0

    clusters_summary = []
    for name in all_clusters:
        total = cluster_totals[name]
        exclusive = cluster_exclusive.get(name, 0)
        clusters_summary.append(
            {
                "name": name,
                "total": total,
                "exclusive": exclusive,
                "exclusive_pct": round(exclusive / total * 100, 1) if total > 0 else 0.0,
                "overlap": total - exclusive,
            }
        )

    pairwise = {}
    for name in all_clusters:
        pairwise[name] = dict(pairwise_overlap[name]) if name in pairwise_overlap else {}

    return {
        "period_hours": period_hours,
        "clusters": clusters_summary,
        "pairwise_overlap": pairwise,
    }


@app.get("/locator/{callsign}")
async def get_locator(callsign: str):
    callsign = callsign.upper()
    qrz_session_key = await get_qrz_session_key_from_redis()

    try:
        geo_data = await get_geo_details(
            app.state.valkey_client,
            qrz_session_key,
            callsign,
            settings.valkey_geo_expiration,
            app.state.http_client,
            "user_request",
        )
    except GeoException:
        geo_data = None

    if geo_data is not None and geo_data.locator and geo_data.lat is not None and geo_data.lon is not None:
        return {
            "callsign": callsign,
            "locator": geo_data.locator,
            "lat": geo_data.lat,
            "lon": geo_data.lon,
            "source": "cache" if geo_data.cached else geo_data.locator_source,
        }
    else:
        return {"callsign": callsign, "error": "not found"}


@app.get("/geocache/all")
async def geocache_all():
    async with async_session() as session:
        geodata = (await session.exec(select(GeoCache))).all()
        return [data.model_dump() for data in geodata]


@app.get("/geocache/{callsign}")
async def geocache(callsign: str):
    async with async_session() as session:
        query = select(GeoCache).where(GeoCache.callsign == callsign.upper())
        geodata = (await session.exec(query)).one_or_none()
        if geodata is not None:
            return geodata.model_dump()
        else:
            return {}


@app.get("/spots_with_issues")
async def spots_with_issues():
    async with async_session() as session:
        spots = (await session.exec(select(SpotsWithIssues))).all()
        spots = [spot.model_dump() for spot in spots]
        return spots


@app.get("/propagation")
def propagation_data():
    return app.state.propagation


@app.get("/propagation/history")
async def propagation_history(start_time: int, end_time: int):
    if end_time < start_time:
        raise HTTPException(status_code=400, detail="end_time must be greater than start_time")
    if end_time - start_time > MAX_PROPAGATION_HISTORY_RANGE_SECONDS:
        raise HTTPException(status_code=400, detail="time range cannot exceed 24 hours")

    return await get_propagation_history_data(start_time, end_time)


@app.get("/voacap")
async def voacap_grid(
    center_lat: float = Query(..., ge=-90.0, le=90.0),
    center_lon: float = Query(..., ge=-180.0, le=180.0),
    band: str = Query(...),
    utc_hour: int | None = Query(default=None, ge=0, le=23),
    month: int | None = Query(default=None, ge=1, le=12),
    ssn: float = Query(default=voacap.DEFAULT_SSN, ge=0.0, le=300.0),
    step_deg: float = Query(default=voacap.DEFAULT_STEP_DEG, ge=1.0, le=30.0),
    metric: voacap.VoacapMetric = voacap.DEFAULT_METRIC,
):
    now = datetime.now(UTC)
    try:
        return await asyncio.to_thread(
            voacap.generate_voacap_grid,
            center_lat=center_lat,
            center_lon=center_lon,
            band=band,
            utc_hour=utc_hour if utc_hour is not None else now.hour,
            month=month if month is not None else now.month,
            ssn=ssn,
            step_deg=step_deg,
            metric=metric,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/dxpeditions")
async def get_dxpeditions():
    dxpeditions_json = await app.state.valkey_client.get("dxpeditions:active")
    if not dxpeditions_json:
        return []
    return json.loads(dxpeditions_json)


@app.websocket("/radio")
async def radio(websocket: fastapi.WebSocket):
    """Dummy websockets endpoint to indicate to the client that radio connection is not available."""
    await websocket.accept()
    await websocket.send_json({"status": "unavailable"})
    await websocket.close()


@app.websocket("/submit_spot")
async def submit_spot_one_spot(websocket: fastapi.WebSocket):
    await websocket.accept()
    missing_jobs = {}
    send_lock = asyncio.Lock()

    try:
        while True:
            try:
                message = await websocket.receive_json()
            except websockets.WebSocketDisconnect:
                break

            if message.get("version") == WS_PROTOCOL_VERSION and message.get("type") == WsMessageType.MISSING.value:
                error = validate_ws_protocol_message(message)
                if error is not None:
                    await send_ws_json(websocket, send_lock, error)
                    continue
                await send_ws_missing(websocket, send_lock, missing_jobs, message)
                continue

            response = await submit_spot.handle_spot(message, app.state.valkey_client)
            await send_ws_json(websocket, send_lock, response)
    finally:
        await cancel_missing_jobs(missing_jobs)


@app.websocket("/ws")
async def ws(websocket: fastapi.WebSocket):
    await websocket.accept()
    missing_jobs = {}
    send_lock = asyncio.Lock()

    try:
        while True:
            try:
                raw_message = await websocket.receive_text()
            except websockets.WebSocketDisconnect:
                break

            try:
                message = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send_json(
                    build_ws_error(WsErrorType.MALFORMED_MESSAGE, "WebSocket message must be valid JSON")
                )
                continue

            error = validate_ws_protocol_message(message)
            if error is not None:
                await websocket.send_json(error)
                continue

            if message.get("type") == WsMessageType.SPOTS.value:
                await send_ws_spots(websocket, message)
                continue

            if message.get("type") == WsMessageType.SUBMIT.value:
                await send_ws_submit(websocket, message)
                continue

            if message.get("type") == WsMessageType.RADIO.value:
                await websocket.send_json(
                    build_ws_message(WsMessageType.RADIO, event=WsRadioEvent.STATUS.value, status="unavailable")
                )
                continue

            if message.get("type") == WsMessageType.MISSING.value:
                await send_ws_missing(websocket, send_lock, missing_jobs, message)
                continue

            if message.get("type") == WsMessageType.HISTORY.value:
                await send_ws_history(websocket, send_lock, message)
                continue

            await websocket.send_json(
                build_ws_error(
                    WsErrorType.NOT_IMPLEMENTED,
                    "WebSocket protocol v1 routing is not implemented yet",
                    received_type=message.get("type"),
                )
            )
    finally:
        await cancel_missing_jobs(missing_jobs)
        app.state.active_ws_spot_connections.discard(websocket)


async def send_ws_submit(websocket: fastapi.WebSocket, message: dict):
    response = await submit_spot.handle_spot(message, app.state.valkey_client)
    if "type" in response:
        response = {**response, "error_type": response["type"]}
        del response["type"]
    await websocket.send_json(build_ws_message(WsMessageType.SUBMIT, **response))


async def send_ws_json(websocket: fastapi.WebSocket, send_lock: asyncio.Lock, message: dict):
    async with send_lock:
        await websocket.send_json(message)


async def send_ws_history(websocket: fastapi.WebSocket, send_lock: asyncio.Lock, message: dict):
    end_time = message["end_time"]
    start_time = message["start_time"]
    event = message.get("event", WsHistoryEvent.SPOTS.value)

    if start_time is None:
        await websocket.send_json(build_ws_error(WsErrorType.MISSING_FIELD, "Missing start_time", field="start_time"))
        return
    if end_time is None:
        await websocket.send_json(build_ws_error(WsErrorType.MISSING_FIELD, "Missing end_time", field="end_time"))
        return

    if end_time < start_time:
        await websocket.send_json(
            build_ws_error(
                WsErrorType.MALFORMED_MESSAGE, "end_time must be greater than start_time", field="start_time"
            )
        )
        return
    if end_time - start_time > MAX_PROPAGATION_HISTORY_RANGE_SECONDS:
        await websocket.send_json(
            build_ws_error(WsErrorType.MALFORMED_MESSAGE, "time range cannot exceed 24 hours", field="end_time")
        )
        return

    if event == WsHistoryEvent.PROPAGATION.value:
        snapped_start = propagation_bucket_start(start_time)
        snapped_end = propagation_bucket_start(max(end_time - 1, start_time)) + PROPAGATION_BUCKET_SECONDS
        raw_history = await get_propagation_history_data(snapped_start, snapped_end)
        result = bucket_propagation_history(raw_history)
        await send_ws_json(
            websocket,
            send_lock,
            build_ws_message(WsMessageType.HISTORY, event=WsHistoryEvent.PROPAGATION.value, **result),
        )
        return

    async with async_session() as session:
        query = (
            select(HolySpot)
            .where(HolySpot.timestamp >= start_time)
            .where(HolySpot.timestamp <= end_time)
            .order_by(HolySpot.timestamp)
        )

        result = (await session.execute(query)).scalars().all()
        spots = cleanup_spots(result)
        payload = {"spots": spots}

        await send_ws_json(
            websocket,
            send_lock,
            build_ws_message(
                WsMessageType.HISTORY,
                event=WsHistoryEvent.SPOTS.value,
                start_time=start_time,
                end_time=end_time,
                spots=payload,
            ),
        )


async def cancel_missing_jobs(missing_jobs):
    tasks = [job.task for job in missing_jobs.values() if job.task is not None]
    for task in tasks:
        if not task.done():
            task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def send_ws_missing(websocket: fastapi.WebSocket, send_lock: asyncio.Lock, missing_jobs, message: dict):
    action = message.get("action")
    job_id = message.get("job_id")
    if not job_id:
        await send_ws_json(
            websocket, send_lock, build_ws_error(WsErrorType.MISSING_FIELD, "Missing job_id", field="job_id")
        )
        return

    if action == WsMissingAction.START.value:
        old_job = missing_jobs.get(job_id)
        if old_job is not None and old_job.task is not None and not old_job.task.done():
            old_job.task.cancel()
        missing_jobs[job_id] = MissingWsJob(job_id=job_id)
        return

    job = missing_jobs.get(job_id)
    if job is None:
        await send_ws_json(
            websocket,
            send_lock,
            build_ws_error(WsErrorType.UNKNOWN_JOB, "Unknown missing job", job_id=job_id),
        )
        return

    if action == WsMissingAction.ADD.value:
        if job.task is not None:
            await send_ws_json(
                websocket,
                send_lock,
                build_ws_error(WsErrorType.UNSUPPORTED_ACTION, "Missing job is already running", job_id=job_id),
            )
            return

        callsigns = message.get("callsigns")
        if not isinstance(callsigns, list):
            await send_ws_json(
                websocket,
                send_lock,
                build_ws_error(WsErrorType.MISSING_FIELD, "Missing callsigns", field="callsigns", job_id=job_id),
            )
            return

        normalized_callsigns, errors = normalize_missing_callsigns(callsigns)
        job.errors.update(errors)
        for callsign in normalized_callsigns:
            if callsign in job.seen_callsigns:
                continue
            job.seen_callsigns.add(callsign)
            job.callsigns.append(callsign)
        return

    if action == WsMissingAction.FINISH.value:
        if job.task is not None and not job.task.done():
            await send_ws_json(
                websocket,
                send_lock,
                build_ws_error(WsErrorType.UNSUPPORTED_ACTION, "Missing job is already running", job_id=job_id),
            )
            return
        job.task = asyncio.create_task(run_missing_resolve_job(websocket, send_lock, job))
        return

    await send_ws_json(
        websocket,
        send_lock,
        build_ws_error(
            WsErrorType.UNSUPPORTED_ACTION, "Unsupported missing action", received_action=action, job_id=job_id
        ),
    )


async def run_missing_resolve_job(websocket: fastapi.WebSocket, send_lock: asyncio.Lock, job: MissingWsJob):
    total = len(job.callsigns) + len(job.errors)
    completed = 0
    await send_ws_json(
        websocket,
        send_lock,
        build_ws_message(WsMessageType.MISSING, event=WsMissingEvent.ACCEPTED.value, job_id=job.job_id, total=total),
    )

    if job.errors:
        completed = len(job.errors)
        await send_ws_json(
            websocket,
            send_lock,
            build_ws_message(
                WsMessageType.MISSING,
                event=WsMissingEvent.RESULTS.value,
                job_id=job.job_id,
                completed=completed,
                total=total,
                results={},
                errors=dict(job.errors),
            ),
        )

    if not job.callsigns:
        await send_ws_json(
            websocket,
            send_lock,
            build_ws_message(
                WsMessageType.MISSING,
                event=WsMissingEvent.COMPLETE.value,
                job_id=job.job_id,
                completed=completed,
                total=total,
            ),
        )
        return

    qrz_session_key = await get_missing_qrz_session_key()
    queue = asyncio.Queue()
    result_queue = asyncio.Queue()

    for callsign in job.callsigns:
        queue.put_nowait(callsign)

    worker_count = min(MISSING_RESOLVE_WORKER_COUNT, len(job.callsigns))
    workers = [
        asyncio.create_task(resolve_missing_queue_worker(queue, result_queue, qrz_session_key))
        for _ in range(worker_count)
    ]
    for _ in workers:
        queue.put_nowait(None)

    batch_results = {}
    batch_errors = {}
    try:
        while completed < total:
            callsign, result, error = await result_queue.get()
            completed += 1
            if error is None:
                batch_results[callsign] = result
            else:
                batch_errors[callsign] = error

            if len(batch_results) + len(batch_errors) >= MISSING_RESOLVE_RESULT_BATCH_SIZE:
                await send_missing_result_batch(
                    websocket, send_lock, job.job_id, completed, total, batch_results, batch_errors
                )
                batch_results = {}
                batch_errors = {}

        if batch_results or batch_errors:
            await send_missing_result_batch(
                websocket, send_lock, job.job_id, completed, total, batch_results, batch_errors
            )

        await asyncio.gather(*workers)
        await send_ws_json(
            websocket,
            send_lock,
            build_ws_message(
                WsMessageType.MISSING,
                event=WsMissingEvent.COMPLETE.value,
                job_id=job.job_id,
                completed=completed,
                total=total,
            ),
        )
    finally:
        for worker in workers:
            if not worker.done():
                worker.cancel()
        await asyncio.gather(*workers, return_exceptions=True)


async def send_missing_result_batch(websocket, send_lock, job_id, completed, total, results, errors):
    await send_ws_json(
        websocket,
        send_lock,
        build_ws_message(
            WsMessageType.MISSING,
            event=WsMissingEvent.RESULTS.value,
            job_id=job_id,
            completed=completed,
            total=total,
            results=results,
            errors=errors,
        ),
    )


async def resolve_missing_queue_worker(queue, result_queue, qrz_session_key):
    while True:
        callsign = await queue.get()
        try:
            if callsign is None:
                return
            try:
                result = await resolve_missing_callsign(callsign, qrz_session_key)
                await result_queue.put((callsign, result, None))
            except GeoException as e:
                await result_queue.put((callsign, None, f"{e.data_type} not found"))
            except Exception:
                logger.exception(f"Failed to resolve missing callsign: {callsign}")
                await result_queue.put((callsign, None, "not found"))
        finally:
            queue.task_done()


async def get_initial_spots():
    async with async_session() as session:
        query = (
            select(HolySpot)
            .where(HolySpot.timestamp > (time.time() - 3600))
            .order_by(desc(HolySpot.timestamp))
            .limit(500)
        )
        return cleanup_spots((await session.execute(query)).scalars())


async def get_spots_after(last_time):
    async with async_session() as session:
        query = select(HolySpot).where(HolySpot.timestamp > last_time).order_by(desc(HolySpot.timestamp)).limit(500)
        return cleanup_spots((await session.execute(query)).scalars())


async def send_ws_spots(websocket: fastapi.WebSocket, message: dict):
    action = message.get("action")
    if action == WsSpotAction.INITIAL.value:
        app.state.active_ws_spot_connections.add(websocket)
        spots = await get_initial_spots()
        await websocket.send_json(build_ws_message(WsMessageType.SPOTS, event=WsSpotEvent.INITIAL.value, spots=spots))
    elif action == WsSpotAction.CATCH_UP.value:
        if "last_time" not in message:
            await websocket.send_json(build_ws_error(WsErrorType.MISSING_FIELD, "Missing last_time", field="last_time"))
            return

        app.state.active_ws_spot_connections.add(websocket)
        spots = await get_spots_after(message["last_time"])
        await websocket.send_json(build_ws_message(WsMessageType.SPOTS, event=WsSpotEvent.UPDATE.value, spots=spots))
    else:
        await websocket.send_json(
            build_ws_error(
                WsErrorType.UNSUPPORTED_ACTION,
                "Unsupported spots action",
                received_action=action,
            )
        )


async def send_spots(websocket: fastapi.WebSocket, message: dict):
    if "initial" in message:
        spots = await get_initial_spots()
        await websocket.send_json({"type": "initial", "spots": spots})
    elif "last_time" in message:
        spots = await get_spots_after(message["last_time"])
        await websocket.send_json({"type": "update", "spots": spots})


@app.websocket("/spots_ws")
async def spots_ws(websocket: fastapi.WebSocket):
    await websocket.accept()

    app.state.active_connections.add(websocket)

    try:
        message = await websocket.receive_json()
        await send_spots(websocket, message)

        while True:
            await websocket.receive_text()

    except websockets.WebSocketDisconnect:
        pass
    finally:
        app.state.active_connections.discard(websocket)


def get_release_manifest():
    try:
        return releases.load_release_manifest(settings.catserver_msi_dir)
    except releases.ReleaseManifestError as e:
        status_code = 404 if str(e) == "No releases found" else 503
        raise HTTPException(status_code=status_code, detail=str(e)) from e


def get_release_artifact(platform: str, architecture: str):
    artifact = get_release_manifest().select(platform, architecture)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Release not found")
    return artifact


def get_latest_catserver_name():
    return get_release_artifact("windows", "x86_64").name


def serve_release_artifact(artifact):
    try:
        path = releases.artifact_path(settings.catserver_msi_dir, artifact.name)
        releases.verify_artifact(path, artifact)
    except releases.ReleaseManifestError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    return FileResponse(
        str(path),
        filename=artifact.name.replace("catserver", "HolyCluster"),
        media_type="application/octet-stream",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/catserver/releases/latest")
def latest_catserver_release():
    return get_release_manifest().as_dict()


@app.get("/catserver/releases/{platform}/{architecture}")
def catserver_release(platform: str, architecture: str):
    return get_release_artifact(platform, architecture).as_dict()


@app.get("/catserver/artifacts/{name}")
def download_catserver_artifact(name: str):
    manifest = get_release_manifest()
    artifact = next((artifact for artifact in manifest.artifacts if artifact.name == name), None)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return serve_release_artifact(artifact)


@app.get("/catserver/latest", response_class=PlainTextResponse)
def latest_catserver():
    return get_latest_catserver_name()


@app.get("/catserver/download")
def download_catserver():
    return serve_release_artifact(get_release_artifact("windows", "x86_64"))


@app.get("/catserver/download/{platform}/{architecture}")
def download_catserver_release(platform: str, architecture: str):
    return serve_release_artifact(get_release_artifact(platform, architecture))


@app.get("/history")
async def spot_history(start_time: int, end_time: int):
    if end_time < start_time:
        logger.info("test 1s")
        raise HTTPException(status_code=400, detail="end_time must be greater than start_time")
    if end_time - start_time > 86400:
        logger.info("test")
        raise HTTPException(status_code=400, detail="time range cannot exceed 24 hours")

    perf = {}

    async with async_session() as session:
        query = (
            select(HolySpot)
            .where(HolySpot.timestamp >= start_time)
            .where(HolySpot.timestamp <= end_time)
            .order_by(HolySpot.timestamp)
        )

        t0 = time.perf_counter()
        result = (await session.execute(query)).scalars().all()
        perf["db_query_ms"] = round((time.perf_counter() - t0) * 1000, 2)
        perf["row_count"] = len(result)

        t1 = time.perf_counter()
        spots = cleanup_spots(result)
        perf["cleanup_ms"] = round((time.perf_counter() - t1) * 1000, 2)

        t2 = time.perf_counter()
        payload = json.dumps({"spots": spots, "perf": perf})
        perf["serialize_ms"] = round((time.perf_counter() - t2) * 1000, 2)
        perf["payload_bytes"] = len(payload)

        logger.info(f"history perf: {perf}")

    return fastapi.Response(content=payload, media_type="application/json")


@app.get("/health")
async def health():
    async with async_session() as session:
        await session.execute(select(HolySpot).limit(1))
    return {"status": "ok"}


@app.get("/cluster_stats")
async def cluster_stats(hours: int | None = None):
    if hours is not None and (hours < 1 or hours > 168):
        raise HTTPException(status_code=400, detail="hours must be between 1 and 168")
    return await compute_cluster_stats(app.state.valkey_client, hours)


@app.get("/")
async def get_index():
    response = FileResponse(f"{settings.ui_dist_path}/index.html", media_type="text/html")
    response.headers["Cache-Control"] = "no-store"
    return response


app.mount("/assets", StaticFiles(directory=f"{settings.ui_dist_path}/assets"), name="static")


@app.get("/{path:path}")
async def spa(path: str):
    response = FileResponse(f"{settings.ui_dist_path}/index.html", media_type="text/html")
    response.headers["Cache-Control"] = "no-store"
    return response
