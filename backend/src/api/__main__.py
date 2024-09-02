from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import fastapi
import uvicorn

from sqlmodel import Field, SQLModel, create_engine, Session, select

from typing import Optional
import datetime

import settings


class DX(SQLModel, table=True):
    __tablename__ = 'dxheat_raw'

    number: Optional[int] = Field(default=None, primary_key=True)
    spotter: str
    frequency: str
    band: str
    mode: str
    dx_call: str
    dx_locator: str
    continent_dx: str
    time: datetime.time
    date: datetime.date


engine = create_engine(settings.DB_URL)
app = fastapi.FastAPI()


origins = [
    "http://holycluster.iarc.org",
    "https://holycluster.iarc.org",
    "http://localhost",
    "http://localhost:8080",
    "http://localhost:8000",
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
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
        mode = spot.mode

    return {
        "spotter": spot.spotter,
        "freq": int(float(spot.frequency)),
        "band": int(float(spot.band)),
        "mode": mode,
        "dx_call": spot.dx_call,
        "dx_locator": spot.dx_locator,
        "time": int(combined_datetime.timestamp()),

        # Coordinates are not yet in the database
        "spotter_loc": [0, 0],
        "dx_loc": [0, 0],
    }


@app.get("/spots")
def spots():
    with Session(engine) as session:
        spots = session.exec(select(DX)).all()
        spots = [
            cleanup_spot(spot)
            for spot in spots
        ]
        spots = sorted(spots, key=lambda spot: spot["time"])
        return spots


@app.websocket("/radio")
async def websocket_endpoint(websocket: fastapi.WebSocket):
    """Dummy websockets endpoint to indicate to the client that radio connection is not available."""
    await websocket.accept()
    await websocket.send_json({"status": 0})
    await websocket.close()


app.mount("/", StaticFiles(directory=settings.UI_DIR, html=True), name="static")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=80)
