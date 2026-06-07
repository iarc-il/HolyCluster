import math
import time
from copy import deepcopy
from enum import StrEnum
from functools import lru_cache

from dvoacap.path_geometry import GeoPoint
from dvoacap.prediction_engine import PredictionEngine


DEFAULT_STEP_DEG = 10.0
DEFAULT_SSN = 100.0
DEFAULT_TX_POWER_WATTS = 100.0
DEFAULT_MIN_TAKEOFF_ANGLE_DEG = 3.0
DEFAULT_REQUIRED_SNR_DB = 10.0


class VoacapMetric(StrEnum):
    SNR_DB = "snr_db"
    RELIABILITY = "reliability"
    MUF_MHZ = "muf_mhz"
    MUF_DAY = "muf_day"


DEFAULT_METRIC = VoacapMetric.SNR_DB

# Representative amateur HF band frequencies in MHz. These intentionally cover
# only HF bands where VOACAP-style skywave prediction is meaningful.
BAND_FREQUENCIES_MHZ = {
    "160": 1.9,
    "80": 3.65,
    "60": 5.35,
    "40": 7.15,
    "30": 10.125,
    "20": 14.15,
    "17": 18.118,
    "15": 21.2,
    "12": 24.94,
    "10": 28.5,
}

def get_band_frequency_mhz(band: str | int | float) -> float:
    normalized_band = str(band).strip().replace("m", "")
    frequency_mhz = BAND_FREQUENCIES_MHZ.get(normalized_band)
    if frequency_mhz is None:
        raise ValueError(f"Unsupported VOACAP band: {band}")
    return frequency_mhz


def generate_voacap_grid(
    *,
    center_lat: float,
    center_lon: float,
    band: str | int | float,
    utc_hour: int,
    month: int,
    ssn: float = DEFAULT_SSN,
    step_deg: float = DEFAULT_STEP_DEG,
    metric: VoacapMetric | str = DEFAULT_METRIC,
) -> dict:
    """Generate a cached VOACAP-style grid from one center point to the globe."""
    normalized = _normalize_request(
        center_lat=center_lat,
        center_lon=center_lon,
        band=band,
        utc_hour=utc_hour,
        month=month,
        ssn=ssn,
        step_deg=step_deg,
        metric=metric,
    )
    return deepcopy(_generate_voacap_grid_cached(**normalized))


def _normalize_request(
    *,
    center_lat: float,
    center_lon: float,
    band: str | int | float,
    utc_hour: int,
    month: int,
    ssn: float,
    step_deg: float,
    metric: VoacapMetric | str,
) -> dict:
    center_lat = _validate_float("center_lat", center_lat, minimum=-90.0, maximum=90.0)
    center_lon = _validate_float("center_lon", center_lon, minimum=-180.0, maximum=180.0)
    ssn = _validate_float("ssn", ssn, minimum=0.0, maximum=300.0)
    step_deg = _validate_float("step_deg", step_deg, minimum=1.0, maximum=30.0)

    utc_hour = int(utc_hour)
    if utc_hour < 0 or utc_hour > 23:
        raise ValueError("utc_hour must be between 0 and 23")

    month = int(month)
    if month < 1 or month > 12:
        raise ValueError("month must be between 1 and 12")

    try:
        metric = VoacapMetric(metric)
    except ValueError as e:
        raise ValueError(f"Unsupported VOACAP metric: {metric}") from e

    normalized_band = str(band).strip().replace("m", "")
    frequency_mhz = get_band_frequency_mhz(normalized_band)

    return {
        "center_lat": round(center_lat, 4),
        "center_lon": round(center_lon, 4),
        "band": normalized_band,
        "frequency_mhz": frequency_mhz,
        "utc_hour": utc_hour,
        "month": month,
        "ssn": round(ssn, 1),
        "step_deg": round(step_deg, 4),
        "metric": metric.value,
    }


def _validate_float(name: str, value: float, *, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as e:
        raise ValueError(f"{name} must be numeric") from e

    if not math.isfinite(parsed):
        raise ValueError(f"{name} must be finite")
    if parsed < minimum or parsed > maximum:
        raise ValueError(f"{name} must be between {minimum:g} and {maximum:g}")
    return parsed


@lru_cache(maxsize=64)
def _generate_voacap_grid_cached(
    *,
    center_lat: float,
    center_lon: float,
    band: str,
    frequency_mhz: float,
    utc_hour: int,
    month: int,
    ssn: float,
    step_deg: float,
    metric: str,
) -> dict:
    engine = PredictionEngine()
    engine.params.ssn = ssn
    engine.params.month = month
    engine.params.tx_power = DEFAULT_TX_POWER_WATTS
    engine.params.tx_location = GeoPoint.from_degrees(center_lat, center_lon)
    engine.params.min_angle = math.radians(DEFAULT_MIN_TAKEOFF_ANGLE_DEG)
    engine.params.required_snr = DEFAULT_REQUIRED_SNR_DB

    utc_fraction = utc_hour / 24.0
    cells = []
    errors = 0

    for lat_min, lat_max in _grid_ranges(-90.0, 90.0, step_deg):
        lat = (lat_min + lat_max) / 2
        for lon_min, lon_max in _grid_ranges(-180.0, 180.0, step_deg):
            lon = (lon_min + lon_max) / 2
            try:
                engine.predict(
                    rx_location=GeoPoint.from_degrees(lat, lon),
                    utc_time=utc_fraction,
                    frequencies=[frequency_mhz],
                )
                prediction = engine.predictions[0]
                snr_db = _round_or_none(prediction.signal.snr_db, 1)
                reliability = _round_or_none(prediction.signal.reliability * 100, 1)
                muf_mhz = _round_or_none(engine.circuit_muf.muf if engine.circuit_muf else None, 2)
                muf_day = _round_or_none(prediction.signal.muf_day * 100, 1)
                value = {
                    "snr_db": snr_db,
                    "reliability": reliability,
                    "muf_mhz": muf_mhz,
                    "muf_day": muf_day,
                }[metric]
            except Exception:
                errors += 1
                snr_db = None
                reliability = None
                muf_mhz = None
                muf_day = None
                value = None

            cells.append(
                {
                    "lat": round(lat, 4),
                    "lon": round(lon, 4),
                    "lat_min": round(lat_min, 4),
                    "lat_max": round(lat_max, 4),
                    "lon_min": round(lon_min, 4),
                    "lon_max": round(lon_max, 4),
                    "value": value,
                    "snr_db": snr_db,
                    "reliability": reliability,
                    "muf_mhz": muf_mhz,
                    "muf_day": muf_day,
                }
            )

    return {
        "generated_at": int(time.time()),
        "model": "dvoacap-python",
        "metric": metric,
        "center": {"lat": center_lat, "lon": center_lon},
        "band": band,
        "frequency_mhz": frequency_mhz,
        "utc_hour": utc_hour,
        "month": month,
        "ssn": ssn,
        "step_deg": step_deg,
        "tx_power_watts": DEFAULT_TX_POWER_WATTS,
        "antenna": "isotropic",
        "path": "short",
        "cells": cells,
        "errors": errors,
    }


def _grid_ranges(start: float, stop: float, step: float):
    current = start
    while current < stop:
        next_value = min(stop, current + step)
        yield current, next_value
        current = next_value


def _round_or_none(value: float | None, digits: int) -> float | None:
    if value is None:
        return None
    if not math.isfinite(value):
        return None
    return round(float(value), digits)


def clear_voacap_cache() -> None:
    _generate_voacap_grid_cached.cache_clear()


def get_voacap_cache_info():
    return _generate_voacap_grid_cached.cache_info()
