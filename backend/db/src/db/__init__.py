from datetime import date, time, datetime
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class GeoCache(SQLModel, table=True):
    __tablename__ = "geo_cache"
    callsign: str = Field(primary_key=True)
    locator: str
    lat: str
    lon: str
    country: str
    continent: str
    date: date
    time: time
    date_time: datetime


class HolySpot(SQLModel, table=True):
    __tablename__ = "holy_spots2"
    __table_args__ = (
        UniqueConstraint(
            "time", "spotter_callsign", "dx_callsign", name="uc_holy_spots2"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    cluster: str
    time: time
    timestamp: int
    frequency: str
    band: str
    mode: str
    mode_selection: str
    spotter_callsign: str
    spotter_locator: str
    spotter_locator_source: str
    spotter_lat: str
    spotter_lon: str
    spotter_country: str
    spotter_continent: str
    dx_callsign: str
    dx_locator: str
    dx_locator_source: str
    dx_lat: str
    dx_lon: str
    dx_country: str
    dx_continent: str
    comment: str


class SpotsWithIssues(SQLModel, table=True):
    __tablename__ = "spots_with_issues2"
    __table_args__ = (
        UniqueConstraint(
            "time", "spotter_callsign", "dx_callsign", name="uc_spots_with_issues2"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    cluster: str
    time: time
    timestamp: int
    frequency: str
    band: str
    mode: str
    mode_selection: str
    spotter_callsign: str
    spotter_locator: str
    spotter_locator_source: str
    spotter_lat: str
    spotter_lon: str
    spotter_country: str
    spotter_continent: str
    dx_callsign: str
    dx_locator: str
    dx_locator_source: str
    dx_lat: str
    dx_lon: str
    dx_country: str
    dx_continent: str
    comment: str
    issues: str
