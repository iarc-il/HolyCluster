from fastapi import FastAPI
from sqlmodel import Field, SQLModel
import uvicorn
import datetime

class DX(SQLModel, table=True):
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


app = FastAPI()


if __name__ == "main":
    uvicorn.run(app, host="0.0.0.0", port=8000)