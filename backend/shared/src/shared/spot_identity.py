from typing import Any


def build_spot_key(spot: dict[str, Any]) -> str:
    return f"{spot['time']}:{spot['dx_callsign']}:{spot['frequency']}:{spot['spotter_callsign']}"
