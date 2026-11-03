from dataclasses import dataclass
from typing import Protocol

SERVICES = ("dxsummit", "dxheat", "dxwatch", "dxdata", "hamqth")
SOURCES = ("holy", *SERVICES)
IDENTITY_FIELDS = ("time", "dx_callsign", "frequency", "spotter_callsign")


def validate_source(source: str) -> None:
    if source not in SOURCES:
        raise ValueError("Unknown coverage source")


def identity(spot: dict) -> str:
    if not isinstance(spot, dict):
        raise ValueError("Expected a normalized spot dict")
    for field in IDENTITY_FIELDS:
        if not isinstance(spot.get(field), (str, int, float)) or isinstance(spot[field], bool):
            raise ValueError(f"Invalid identity field: {field}")
    return ":".join(str(spot[field]) for field in IDENTITY_FIELDS)


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
