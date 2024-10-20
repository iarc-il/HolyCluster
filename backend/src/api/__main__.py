from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import fastapi
import uvicorn

from sqlmodel import Field, SQLModel, create_engine, Session, select

from typing import Optional
import datetime

from . import settings


class DX(SQLModel, table=True):
    __tablename__ = 'holy_spots'

    id: Optional[int] = Field(default=None, primary_key=True)
    dx_callsign: str
    dx_locator: str
    dx_lat: str
    dx_lon: str
    dx_country: str
    spotter_callsign: str
    spotter_lat: str
    spotter_lon: str
    frequency: str
    band: str
    mode: str
    time: datetime.time
    date: datetime.date


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


engine = create_engine(settings.DB_URL)
app = fastapi.FastAPI()

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
    date = spot.date
    time = spot.time
    combined_datetime = datetime.datetime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
        time.second,
        tzinfo=datetime.timezone.utc,
    )

    if spot.mode.upper() in ("SSB", "USB", "LSB"):
        mode = "SSB"
    else:
        mode = spot.mode.upper()

    return {
        "id": spot.id,
        "spotter_callsign": spot.spotter_callsign,
        "spotter_loc": [float(spot.spotter_lon), float(spot.spotter_lat)],
        "dx_callsign": spot.dx_callsign,
        "dx_loc": [float(spot.dx_lon), float(spot.dx_lat)],
        "dx_locator": spot.dx_locator,
        "dx_country": spot.dx_country,
        "freq": int(float(spot.frequency)),
        "band": int(float(spot.band)),
        "mode": mode,
        "time": int(combined_datetime.timestamp()),
    }


@app.get("/spots")
def spots():
    with Session(engine) as session:
        spots = session.exec(select(DX)).all()
        spots = [
            cleanup_spot(spot)
            for spot in spots
        ]
        spots = sorted(spots, key=lambda spot: spot["time"], reverse=True)
        return spots


@app.get("/spots_with_issues")
def spots_with_issues():
    with Session(engine) as session:
        spots = session.exec(select(SpotsWithIssues)).all()
        spots = [spot.model_dump() for spot in spots]
        return spots


@app.websocket("/radio")
async def websocket_endpoint(websocket: fastapi.WebSocket):
    """Dummy websockets endpoint to indicate to the client that radio connection is not available."""
    await websocket.accept()
    await websocket.send_json({"status": "unavailable"})
    await websocket.close()


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
