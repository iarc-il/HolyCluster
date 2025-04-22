from contextlib import asynccontextmanager
import asyncio
import datetime
import logging
import re
import time
from typing import Optional

from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi import websockets
import fastapi
import uvicorn

from sqlmodel import Field, SQLModel, create_engine, Session, select
from sqlalchemy import desc

from . import propagation, settings


class DX(SQLModel, table=True):
    __tablename__ = 'holy_spots'

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
        "freq": int(float(spot.frequency)),
        "band": int(float(spot.band)),
        "mode": mode,
        "time": int(spot.date_time.timestamp()),
        "comment": spot.comment,
    }


@app.get("/spots")
def spots(since: Optional[int] = None):
    with Session(engine) as session:
        query = select(DX)
        if since is None:
            since = int(time.time() - 3600)
        query = query \
            .where(DX.date_time > datetime.datetime.fromtimestamp(since)) \
            .order_by(desc(DX.date_time)).limit(500)
        spots = session.exec(query).all()
        spots = [
            cleanup_spot(spot)
            for spot in spots
        ]
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


async def send_dx_spot(cluster_host, cluster_port, spotter_callsign, dx_callsign, frequency):
    pass

# Example usage:
# asyncio.run(send_dx_spot("dxcluster.example.com", 7300, "YOURCALL", "DXCALL", "14000.0"))

CLUSTER_HOST = "dxc.k0xm.net"
CLUSTER_PORT = 7300


class InvalidSpotter(Exception):
    def __str__(self):
        return "Invalid spotter"


class LoginFailed(Exception):
    def __str__(self):
        return "Login failed"


class CommandError(Exception):
    def __init__(self, command):
        self.command = command

    def __str__(self):
        return f"Invalid command: {self.command}"


class OtherError(Exception):
    def __str__(self):
        return "Other error"


class InvalidFrequency(Exception):
    def __str__(self):
        return "Invalid frequency"


class InvalidDXCallsign(Exception):
    def __str__(self):
        return "Invalid dx callsign"


class ClusterConnectionFailed(Exception):
    def __str__(self):
        return "Failed to connect to the cluster"


async def expect_lines_inner(reader, valid_line, invalid_lines):
    while True:
        line = await reader.readline()
        line = line.decode("utf-8", "ignore")

        print(line.strip())
        if isinstance(valid_line, re.Pattern):
            if valid_line.search(line) is not None:
                return
        elif valid_line in line:
            return
        else:
            print(f"line: {repr(line)} is not {repr(valid_line)}")
        for invalid_line, exception in invalid_lines.items():
            if invalid_line in line:
                raise exception


async def expect_lines(reader, valid_line, invalid_lines, default_exception=None):
    try:
        await asyncio.wait_for(
            expect_lines_inner(reader, valid_line, invalid_lines),
            timeout=5
        )
    except TimeoutError:
        logger.warning(f"Got timeout while waiting for: {valid_line}")
        if default_exception is not None:
            raise default_exception


async def connect_to_server():
    async def inner_connect():
        return await asyncio.open_connection(CLUSTER_HOST, CLUSTER_PORT)

    for i in range(5):
        try:
            return await asyncio.wait_for(inner_connect(), timeout=3)
        except TimeoutError:
            logger.error(f"Failed to connect to cluster at {CLUSTER_HOST}:{CLUSTER_PORT}, {i} retry")
    else:
        raise ClusterConnectionFailed()


async def handle_one_spot(websocket):
    data = await websocket.receive_json()

    try:
        if data["spotter_callsign"] == "":
            raise InvalidSpotter()
        if data["dx_callsign"] == "":
            raise InvalidDXCallsign()

        reader, writer = await connect_to_server()
        writer.write(f"{data['spotter_callsign']}\n".encode())
        await expect_lines(
            reader,
            "Hello",
            {"is not a valid callsign": InvalidSpotter()},
            LoginFailed(),
        )

        spot_command = f"DX {float(data['freq'])} {data['dx_callsign']} {data['comment']}\n"
        print("Writing:", spot_command)
        writer.write(spot_command.encode())

        await expect_lines(
            reader,
            re.compile(fr"DX de\s*{data['spotter_callsign']}:\s*{float(data['freq'])}\s*{data['dx_callsign']}"),
            {
                "command error": CommandError(spot_command),
                "Error - DX": OtherError(),
                "Error - invalid frequency": InvalidFrequency(),
                "Error - Invalid Dx Call": InvalidDXCallsign(),
            },
        )
        writer.close()
        await writer.wait_closed()

        await websocket.send_json({"status": "success"})
        logger.info(f"Spot submitted sucessfully: {data}")
    except Exception as e:
        response = {
            "status": "failure",
            "type": e.__class__.__name__,
            "error_data": str(e),
        }
        logger.exception(f"Failed to submit spot: {data}, Response: {response}")
        await websocket.send_json(response)


@app.websocket("/submit_spot")
async def submit_spot(websocket: fastapi.WebSocket):
    await websocket.accept()
    while True:
        try:
            await handle_one_spot(websocket)
        except websockets.WebSocketDisconnect:
            break


app.mount("/", StaticFiles(directory=settings.UI_DIR, html=True), name="static")


if __name__ == "__main__":
    if settings.SSL_AVAILABLE:
        port = 443
        ssl_kwargs = {
            "ssl_keyfile": settings.SSL_KEYFILE,
            "ssl_certfile": settings.SSL_CERTFILE
        }
    else:
        port = 80
        ssl_kwargs = {}

    uvicorn.run(app, host="0.0.0.0", port=port, **ssl_kwargs)
