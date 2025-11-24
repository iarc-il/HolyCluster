from sqlmodel import SQLModel, Field
from typing import Optional
from sqlalchemy import UniqueConstraint, Column, Time, DateTime, String
from datetime import datetime, time

class HolySpot2(SQLModel, table=True):
    model_config = {
        "arbitrary_types_allowed": True
    }
    __tablename__ = "holy_spots2"

    __table_args__ = (
        UniqueConstraint("time", "spotter_callsign", "dx_callsign"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)

    cluster: Optional[str] = None
    time: Optional[time] = Field(default=None, sa_column=Column(Time()))
    date_time: Optional[datetime] = Field(default=None, sa_column=Column(DateTime()))
    frequency: Optional[str] = None
    band: Optional[str] = None
    mode: Optional[str] = None
    mode_selection: Optional[str] = None
    spotter_callsign: Optional[str] = None
    spotter_locator: Optional[str] = None
    spotter_locator_source: Optional[str] = None
    spotter_lat: Optional[str] = None
    spotter_lon: Optional[str] = None
    spotter_country: Optional[str] = None
    spotter_continent: Optional[str] = None
    dx_callsign: Optional[str] = None
    dx_locator: Optional[str] = None
    dx_locator_source: Optional[str] = None
    dx_lat: Optional[str] = None
    dx_lon: Optional[str] = None
    dx_country: Optional[str] = None
    dx_continent: Optional[str] = None
    comment: Optional[str] = None

    def __repr__(self):
        classname = self.__class__.__name__
        parts = []

        for key in self.__fields__.keys():
            parts.append(f"  {key}={getattr(self, key)!r}")

        inner = ",\n".join(parts)
        return f"<{classname}(\n{inner}\n)>"

    def to_dict(self):
        return {
            key: getattr(self, key)
            for key in self.__fields__.keys()
        }

class SpotsWithIssues2(SQLModel, table=True):
    model_config = {
        "arbitrary_types_allowed": True
    }
    __tablename__ = "spots_with_issues2"

    __table_args__ = (
        UniqueConstraint("time", "spotter_callsign", "dx_callsign"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)

    cluster: Optional[str] = None
    time: Optional[time] = Field(default=None, sa_column=Column(Time()))
    date_time: Optional[datetime] = Field(default=None, sa_column=Column(DateTime()))
    frequency: Optional[str] = None
    band: Optional[str] = None
    mode: Optional[str] = None
    mode_selection: Optional[str] = None
    spotter_callsign: Optional[str] = None
    spotter_locator: Optional[str] = None
    spotter_locator_source: Optional[str] = None
    spotter_lat: Optional[str] = None
    spotter_lon: Optional[str] = None
    spotter_country: Optional[str] = None
    spotter_continent: Optional[str] = None
    dx_callsign: Optional[str] = None
    dx_locator: Optional[str] = None
    dx_locator_source: Optional[str] = None
    dx_lat: Optional[str] = None
    dx_lon: Optional[str] = None
    dx_country: Optional[str] = None
    dx_continent: Optional[str] = None
    comment: Optional[str] = None
    issues: Optional[str] = None

    def __repr__(self):
        classname = self.__class__.__name__
        parts = []

        for key in self.__fields__.keys():
            parts.append(f"  {key}={getattr(self, key)!r}")

        inner = ",\n".join(parts)
        return f"<{classname}(\n{inner}\n)>"

    def to_dict(self):
        return {
            key: getattr(self, key)
            for key in self.__fields__.keys()
        }

