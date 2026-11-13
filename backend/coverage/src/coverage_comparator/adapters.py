import json
import math
import re
from dataclasses import dataclass
from typing import Protocol

SERVICES = ("dxsummit", "dxheat", "dxwatch", "dxdata", "hamqth", "dxscape")
SOURCES = ("holy", *SERVICES)
IDENTITY_FIELDS = ("time", "dx_callsign", "frequency", "spotter_callsign")
MATCH_FIELDS = ("dx_callsign", "frequency", "spotter_callsign")


def validate_source(source: str) -> None:
    if source not in SOURCES:
        raise ValueError("Unknown coverage source")


def identity(spot: dict) -> str:
    if not isinstance(spot, dict):
        raise ValueError("Expected a normalized spot dict")
    for field in IDENTITY_FIELDS:
        if not isinstance(spot.get(field), (str, int, float)) or isinstance(spot[field], bool):
            raise ValueError(f"Invalid identity field: {field}")
    dx = str(spot["dx_callsign"]).strip().upper()
    spotter = re.sub(r"-\d+$", "", str(spot["spotter_callsign"]).strip().upper())
    frequency = float(spot["frequency"])
    if not dx or not spotter or not math.isfinite(frequency) or frequency <= 0:
        raise ValueError("Invalid normalized identity")
    values = {"dx_callsign": dx, "frequency": frequency, "spotter_callsign": spotter}
    return ":".join(str(values[field]) for field in MATCH_FIELDS)


def encode_spot(spot: dict, max_bytes: int) -> str:
    identity(spot)
    encoded = json.dumps(spot, allow_nan=False)
    if len(encoded.encode()) > max_bytes:
        raise ValueError("Spot exceeds the sample size limit")
    return encoded


@dataclass
class Snapshot:
    spots: list[dict]
    saturated: bool = False
    recoverable: bool = True


class Adapter(Protocol):
    service: str
    poll_interval: float

    async def poll(self) -> Snapshot: ...

    async def close(self) -> None: ...


class FakeAdapter:
    def __init__(self, service: str, snapshots: list[Snapshot]):
        if service not in SERVICES:
            raise ValueError("Unknown coverage service")
        self.service = service
        self.poll_interval = 1.0
        self.snapshots = iter(snapshots)

    async def poll(self) -> Snapshot:
        return next(self.snapshots)

    async def close(self) -> None:
        pass
