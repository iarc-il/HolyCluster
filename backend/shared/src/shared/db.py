from datetime import date, datetime, time
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class GeoCache(SQLModel, table=True):
    __tablename__ = "geo_cache"
    callsign: str = Field(primary_key=True)
    locator: str
    lat: str
    lon: str
    dxcc_code: int
    continent: str
    date: date
    time: time
    date_time: datetime


class HolySpot(SQLModel, table=True):
    __tablename__ = "holy_spots2"
    __table_args__ = (UniqueConstraint("time", "spotter_callsign", "dx_callsign", name="uc_holy_spots2"),)

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
    spotter_dxcc_code: int
    spotter_continent: str
    spotter_state: str
    spotter_cq_zone: Optional[int] = None
    spotter_itu_zone: Optional[int] = None
    dx_callsign: str
    dx_locator: str
    dx_locator_source: str
    dx_lat: str
    dx_lon: str
    dx_dxcc_code: int
    dx_continent: str
    dx_state: str
    dx_cq_zone: Optional[int] = None
    dx_itu_zone: Optional[int] = None
    pota_reference: Optional[str] = None
    pota_name: Optional[str] = None
    pota_description: Optional[str] = None
    sota_points: Optional[int] = None
    comment: str
    is_dxpedition: int


class SpotsWithIssues(SQLModel, table=True):
    __tablename__ = "spots_with_issues2"
    __table_args__ = (UniqueConstraint("time", "spotter_callsign", "dx_callsign", name="uc_spots_with_issues2"),)

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
    spotter_dxcc_code: Optional[int] = None
    spotter_continent: str
    spotter_state: str
    spotter_cq_zone: Optional[int] = None
    spotter_itu_zone: Optional[int] = None
    dx_callsign: str
    dx_locator: str
    dx_locator_source: str
    dx_lat: str
    dx_lon: str
    dx_dxcc_code: Optional[int] = None
    dx_continent: str
    dx_state: str
    dx_cq_zone: Optional[int] = None
    dx_itu_zone: Optional[int] = None
    comment: str
    issues: str
    is_dxpedition: int
