"""
Minimal standalone server for the /spots endpoint.
Used for local development — connects to the production DB via SSH tunnel.

Setup:
1. Copy .env.example to .env and fill in POSTGRES_USER, POSTGRES_PASSWORD
2. Open SSH tunnel:  ssh -L 15432:localhost:5432 <user>@holycluster-dev.iarc.org
3. Install deps:     pip install fastapi uvicorn asyncpg sqlmodel python-dotenv
4. Run:             python spots_server.py
5. Server runs on http://localhost:8001
"""

import time
from dotenv import load_dotenv
import os

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import sqlalchemy
from sqlalchemy import desc, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
import uvicorn

POSTGRES_USER     = os.environ["POSTGRES_USER"]
POSTGRES_PASSWORD = os.environ["POSTGRES_PASSWORD"]
POSTGRES_DB       = os.environ.get("POSTGRES_DB_NAME", "holy_cluster")
POSTGRES_HOST     = os.environ.get("POSTGRES_HOST_LOCAL", "localhost")
POSTGRES_PORT     = os.environ.get("POSTGRES_PORT_LOCAL", "15432")

DB_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

engine = create_async_engine(DB_URL, pool_size=5, max_overflow=10)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def cleanup_spot(spot):
    try:
        mode = spot["mode"].upper()
        if mode in ("SSB", "USB", "LSB"):
            mode = "SSB"

        band = spot["band"].upper() if spot["band"].upper() in ("VHF", "UHF", "SHF") else float(spot["band"])

        return {
            "spotter_callsign":  spot["spotter_callsign"],
            "spotter_loc":       [float(spot["spotter_lon"]), float(spot["spotter_lat"])],
            "spotter_country":   spot["spotter_country"],
            "spotter_continent": spot["spotter_continent"],
            "spotter_state":     spot.get("spotter_state"),
            "dx_callsign":       spot["dx_callsign"],
            "dx_loc":            [float(spot["dx_lon"]), float(spot["dx_lat"])],
            "dx_country":        spot["dx_country"],
            "dx_continent":      spot["dx_continent"],
            "dx_state":          spot.get("dx_state"),
            "freq":              float(spot["frequency"]),
            "band":              band,
            "mode":              mode,
            "time":              float(spot["timestamp"]),
            "comment":           spot["comment"],
            "is_dxpedition":     bool(int(spot.get("is_dxpedition", 0))),
        }
    except Exception:
        return None


@app.get("/spots")
async def get_spots(start_time: float, end_time: float):
    if end_time <= start_time:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")
    if end_time - start_time > 86400:
        raise HTTPException(status_code=400, detail="Time range cannot exceed 24 hours")

    async with async_session() as session:
        result = await session.execute(
            text("""
                SELECT spotter_callsign, spotter_lat, spotter_lon, spotter_country,
                       spotter_continent, spotter_state, dx_callsign, dx_lat, dx_lon,
                       dx_country, dx_continent, dx_state, frequency, band, mode,
                       timestamp, comment, is_dxpedition
                FROM holy_spots2
                WHERE timestamp >= :start_time AND timestamp <= :end_time
                ORDER BY timestamp DESC
                LIMIT 5000
            """),
            {"start_time": start_time, "end_time": end_time},
        )
        rows = [dict(row._mapping) for row in result]

    spots = [cleanup_spot(row) for row in rows]
    spots = [s for s in spots if s is not None]
    return spots


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)
