import asyncio
import logging
import time
from contextlib import asynccontextmanager
import os

import fastapi
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi import HTTPException, Request, websockets
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import desc
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlmodel import select
import redis.asyncio

from db import GeoCache, HolySpot, SpotsWithIssues
from . import propagation, settings, submit_spot


logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.WARNING)


async def propagation_data_collector(app):
    while True:
        sleep = 3600
        try:
            app.state.propagation = await propagation.collect_propagation_data()
            app.state.propagation["time"] = int(time.time())
            logger.info(f"Got propagation data: {app.state.propagation}")
        except Exception as e:
            sleep = 10
            logger.exception(f"Failed to fetch propagation data: {str(e)}")
        await asyncio.sleep(sleep)


async def spots_broadcast_task(app):
    STREAM_NAME = "stream-api"
    CONSUMER_GROUP = "api-group"
    CONSUMER_NAME = "consumer_1"

    valkey_client = redis.asyncio.Redis(host=settings.VALKEY_HOST, port=settings.VALKEY_PORT, db=0, decode_responses=True)

    try:
        await valkey_client.xgroup_create(STREAM_NAME, CONSUMER_GROUP, id="0", mkstream=True)
    except redis.exceptions.ResponseError:
        pass

    while True:
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

                    spots.append(cleanup_spot(spot))

                message = {"type": "update", "spots": spots}

                disconnected = set()
                for websocket in app.state.active_connections.copy():
                    try:
                        await websocket.send_json(message)
                    except Exception as e:
                        logger.warning(f"Failed to send to websocket: {e}")
                        disconnected.add(websocket)

                for websocket in disconnected:
                    app.state.active_connections.discard(websocket)

        except Exception as e:
            logger.exception(f"Error in spots broadcast task: {e}")


@asynccontextmanager
async def lifespan(app: fastapi.FastAPI):
    app.state.active_connections = set()

    tasks = [
        asyncio.create_task(propagation_data_collector(app)),
        asyncio.create_task(spots_broadcast_task(app)),
    ]

    yield

    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


engine = create_async_engine(
    settings.DB_URL,
    pool_size=10,
    max_overflow=20,
    pool_timeout=30,
    pool_pre_ping=True,
    pool_recycle=3600,
)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

app = fastapi.FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def cleanup_spot(spot):
    if spot["mode"].upper() in ("SSB", "USB", "LSB"):
        mode = "SSB"
    else:
        mode = spot["mode"].upper()

    if spot["band"].upper() not in ("VHF", "UHF", "SHF"):
        band = float(spot["band"])
    else:
        band = spot["band"]

    return {
        "spotter_callsign": spot["spotter_callsign"],
        "spotter_loc": [float(spot["spotter_lon"]), float(spot["spotter_lat"])],
        "spotter_country": spot["spotter_country"],
        "spotter_continent": spot["spotter_continent"],
        "dx_callsign": spot["dx_callsign"],
        "dx_loc": [float(spot["dx_lon"]), float(spot["dx_lat"])],
        "dx_country": spot["dx_country"],
        "dx_continent": spot["dx_continent"],
        "freq": float(spot["frequency"]),
        "band": band,
        "mode": mode,
        "time": float(spot["timestamp"]),
        "comment": spot["comment"],
    }


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


@app.websocket("/radio")
async def radio(websocket: fastapi.WebSocket):
    """Dummy websockets endpoint to indicate to the client that radio connection is not available."""
    await websocket.accept()
    await websocket.send_json({"status": "unavailable"})
    await websocket.close()


@app.websocket("/submit_spot")
async def submit_spot_one_spot(websocket: fastapi.WebSocket):
    await websocket.accept()
    while True:
        try:
            await submit_spot.handle_one_spot(websocket)
        except websockets.WebSocketDisconnect:
            break


@app.websocket("/spots_ws")
async def spots_ws(websocket: fastapi.WebSocket):
    await websocket.accept()

    app.state.active_connections.add(websocket)

    try:
        message = await websocket.receive_json()

        async with async_session() as session:
            if "initial" in message:
                query = select(HolySpot).where(HolySpot.timestamp > (time.time() - 3600)).order_by(desc(HolySpot.timestamp)).limit(500)
                initial_spots = (await session.execute(query)).scalars()

                initial_spots = [cleanup_spot(dict(spot)) for spot in initial_spots]
                await websocket.send_json({"type": "initial", "spots": initial_spots})
            elif "last_time" in message:
                query = select(HolySpot).where(HolySpot.timestamp > message["last_time"]).order_by(desc(HolySpot.timestamp)).limit(500)
                missed_spots = (await session.execute(query)).scalars()

                missed_spots = [cleanup_spot(dict(spot)) for spot in missed_spots]
                await websocket.send_json({"type": "update", "spots": missed_spots})

        while True:
            await websocket.receive_text()

    except websockets.WebSocketDisconnect:
        pass
    finally:
        app.state.active_connections.discard(websocket)


def get_latest_catserver_name():
    latest_file_path = settings.CATSERVER_MSI_DIR / "latest"
    if not latest_file_path.exists():
        raise HTTPException(status_code=404, detail="No latest version found")

    return latest_file_path.read_text().strip()


@app.get("/catserver/latest", response_class=PlainTextResponse)
def latest_catserver():
    return get_latest_catserver_name()


@app.get("/catserver/download")
def download_catserver():
    filename = get_latest_catserver_name()
    file_to_serve = settings.CATSERVER_MSI_DIR / filename
    if not file_to_serve.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        str(file_to_serve), filename=filename.replace("catserver", "HolyCluster"), media_type="application/octet-stream"
    )


@app.get("/")
async def get_index():
    response = FileResponse(f"{settings.UI_DIST_PATH}/index.html", media_type="text/html")
    response.headers["Cache-Control"] = "no-store"
    return response


app.mount("/", StaticFiles(directory=settings.UI_DIST_PATH, html=True), name="static")


@app.exception_handler(StarletteHTTPException)
async def spa_fallback(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404 and request.url.path not in ("/favicon.ico",):
        index_path = os.path.join(settings.UI_DIST_PATH, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path, media_type="text/html")
    raise exc
