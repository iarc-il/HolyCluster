from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI
from sqlmodel import Field, SQLModel, create_engine
import uvicorn

from typing import Optional
import datetime
import os

import settings


class DX(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    number: int
    spotter: str
    frequency: str
    dx_call: str
    time: datetime.time
    date: datetime.date
    beacon: bool
    mm: bool
    am: bool
    am: bool
    valid: bool
    lotw: bool
    lotw_date: bool
    esql: bool
    dx_homecall: str
    comment: str
    flag: str
    band: str
    continent_dx: str
    continent_spotter: str
    dx_locator: str


engine = create_engine(settings.DB_URL)
app = FastAPI()


app.mount("/", StaticFiles(directory=settings.UI_DIR, html=True), name="static")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
