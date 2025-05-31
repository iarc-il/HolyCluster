import asyncio
import datetime
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

import fastapi
import uvicorn
from fastapi import HTTPException, websockets
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import desc
from sqlmodel import Field, Session, SQLModel, create_engine, select

from . import propagation, settings, submit_spot


class DX(SQLModel, table=True):
    __tablename__ = "holy_spots"

    id: Optional[int] = Field(default=None, primary_key=True)
    dx_callsign: str
    dx_lat: str
    dx_lon: str
    dx_country: str
    dx_continent: str
    spotter_callsign: str
    spotter_lat: str
    spotter_lon: str
    spotter_country: str
    spotter_continent: str
    frequency: str
    band: str
    mode: str
    date_time: datetime.datetime
    comment: str


class SpotsWithIssues(SQLModel, table=True):
    __tablename__ = "spots_with_issues"
    id: Optional[int] = Field(default=None, primary_key=True)
    time: datetime.time
    date: datetime.date
    band: str
    frequency: str
    spotter_callsign: str
    spotter_locator: str
    spotter_lat: str
    spotter_lon: str
    spotter_country: str
    dx_callsign: str
    dx_locator: str
    dx_lat: str
    dx_lon: str
    dx_country: str
    comment: str


class GeoCache(SQLModel, table=True):
    __tablename__ = "geo_cache"
    callsign: str = Field(primary_key=True)
    locator: str


logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


async def propagation_data_collector(app):
    while True:
        sleep = 3600
        try:
            app.state.propagation = await propagation.collect_propagation_data()
            app.state.propagation["time"] = int(time.time())
            logger.info(f"Got propagation data: {app.state.propagation}")
        except Exception as e:
            sleep = 10
            logger.exception(f"Failed to fetch spots: {str(e)}")
        await asyncio.sleep(sleep)


@asynccontextmanager
async def lifespan(app: fastapi.FastAPI):
    asyncio.get_running_loop().create_task(propagation_data_collector(app))
    yield


engine = create_engine(settings.DB_URL)
app = fastapi.FastAPI(lifespan=lifespan)

if settings.SSL_AVAILABLE:
    import ssl
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_context.load_cert_chain(settings.SSL_CERTFILE, keyfile=settings.SSL_KEYFILE)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def cleanup_spot(spot):
    if spot.mode.upper() in ("SSB", "USB", "LSB"):
        mode = "SSB"
    else:
        mode = spot.mode.upper()

    return {
        "id": spot.id,
        "spotter_callsign": spot.spotter_callsign,
        "spotter_loc": [float(spot.spotter_lon), float(spot.spotter_lat)],
        "spotter_country": spot.spotter_country,
        "spotter_continent": spot.spotter_continent,
        "dx_callsign": spot.dx_callsign,
        "dx_loc": [float(spot.dx_lon), float(spot.dx_lat)],
        "dx_country": spot.dx_country,
        "dx_continent": spot.dx_continent,
        "freq": float(spot.frequency),
        "band": int(float(spot.band)),
        "mode": mode,
        "time": int(spot.date_time.timestamp()),
        "comment": spot.comment,
    }


@app.get("/spots")
def spots(since: Optional[int] = None, last_id: Optional[int] = None):
    with Session(engine) as session:
        if since is None:
            since = int(time.time() - 3600)

        query = select(DX).where(DX.date_time > datetime.datetime.fromtimestamp(since))
        if last_id is not None:
            query = query.where(DX.id > last_id)

        query = query.order_by(desc(DX.id))
        spots = session.exec(query).all()
        spots = [cleanup_spot(spot) for spot in spots]
        return spots


@app.get("/geocache/all")
def geocache_all():
    with Session(engine) as session:
        geodata = session.exec(select(GeoCache)).all()
        return [data.model_dump() for data in geodata]


@app.get("/geocache/{callsign}")
def geocache(callsign: str):
    with Session(engine) as session:
        query = select(GeoCache).where(GeoCache.callsign == callsign.upper())
        geodata = session.exec(query).one_or_none()
        if geodata is not None:
            return geodata.model_dump()
        else:
            return {}


@app.get("/spots_with_issues")
def spots_with_issues():
    with Session(engine) as session:
        spots = session.exec(select(SpotsWithIssues)).all()
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
    response = FileResponse(f"{settings.UI_DIR}/index.html", media_type="text/html")
    response.headers["Cache-Control"] = "no-store"
    return response


app.mount("/", StaticFiles(directory=settings.UI_DIR, html=True), name="static")


if __name__ == "__main__":
    if settings.SSL_AVAILABLE:
        port = 443
        ssl_kwargs = {"ssl_keyfile": settings.SSL_KEYFILE, "ssl_certfile": settings.SSL_CERTFILE}
    else:
        port = 80
        ssl_kwargs = {}

    uvicorn.run(app, host="0.0.0.0", port=port, **ssl_kwargs)
