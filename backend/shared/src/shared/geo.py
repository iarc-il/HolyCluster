import json
from dataclasses import replace

from pydantic import BaseModel

from shared.coordinates import coordinates_to_locator, locator_to_coordinates
from shared.cty import CtyCountry, get_cty_resolver
from shared.qrz import get_locator_from_qrz


class GeoException(Exception):
    def __init__(self, callsign: str, callsign_type: str, data_type: str, notify_monitor: bool = True):
        self.callsign = callsign
        self.callsign_type = callsign_type
        self.data_type = data_type
        self.notify_monitor = notify_monitor


class GeoData(BaseModel):
    cached: bool
    locator_source: str
    locator: str
    lon: float
    lat: float
    dxcc_code: int
    country: str
    continent: str
    state: str
    cq_zone: int | None = None
    itu_zone: int | None = None


_DXCC_OVERRIDES_BY_CALLSIGN = {
    "2R0PLA": (223, "England", "EU"),
    "4U5ITU": (117, "ITU HQ", "EU"),
    "BB4IA": (318, "China", "AS"),
    "BB4TVU": (318, "China", "AS"),
    "KH7X": (110, "Hawaii", "OC"),
    "KL2A": (6, "Alaska", "NA"),
    "NL5Y": (6, "Alaska", "NA"),
    "R95WTA": (15, "Asiatic Russia", "AS"),
    "RP2F": (126, "Kaliningrad", "EU"),
    "RI0SP": (15, "Asiatic Russia", "AS"),
    "T94A": (501, "Bosnia and Herzegovina", "EU"),
    "T9BLB/IH9": (501, "Bosnia and Herzegovina", "EU"),
    "VD9WH": (1, "Canada", "NA"),
    "VO/DF6MS": (1, "Canada", "NA"),
    "VO3A": (1, "Canada", "NA"),
    "VQ0X": (89, "Turks and Caicos Islands", "NA"),
    "VS6AI": (321, "Hong Kong", "AS"),
    "YZ5W": (296, "Serbia", "EU"),
}

_DXCC_OVERRIDES_BY_PREFIX = {
    "BE": (318, "China", "AS"),
    "DP0": (13, "Antarctica", "AN"),
    "EA9": (32, "Ceuta and Melilla", "AF"),
    "JD/": (192, "Ogasawara", "AS"),
    "VO0": (1, "Canada", "NA"),
}


def _resolve_dxcc_override(callsign: str) -> tuple[int, str, str] | None:
    callsign = callsign.upper()
    if callsign in _DXCC_OVERRIDES_BY_CALLSIGN:
        return _DXCC_OVERRIDES_BY_CALLSIGN[callsign]
    for prefix, dxcc_code in _DXCC_OVERRIDES_BY_PREFIX.items():
        if callsign.startswith(prefix):
            return dxcc_code
    return None


def _resolve_cty_entity(callsign: str) -> CtyCountry | None:
    cty_resolver = get_cty_resolver()
    if cty_resolver is None:
        raise RuntimeError("CTY resolver is unavailable")

    dxcc_override = _resolve_dxcc_override(callsign)
    if dxcc_override is not None:
        dxcc_code, country, continent = dxcc_override
        cty_country = cty_resolver.get_entity_by_dxcc_code(dxcc_code)
        if cty_country is None:
            cty_country = next(
                (entity for entity in cty_resolver.prefixes.values() if entity.dxcc_code == dxcc_code),
                None,
            )
        if cty_country is None:
            return None
        return replace(cty_country, country=country, continent=continent)

    return cty_resolver.resolve_entity(callsign)


def resolve_dxcc_entity(
    callsign: str,
    callsign_type: str,
) -> CtyCountry:
    cty_country = _resolve_cty_entity(callsign)
    if cty_country is not None:
        return cty_country
    raise GeoException(
        callsign,
        callsign_type,
        "dxcc_code",
        notify_monitor=False,
    )


def resolve_dxcc_and_continent(
    callsign: str,
    callsign_type: str,
) -> tuple[int, str]:
    cty_country = resolve_dxcc_entity(callsign, callsign_type)
    return cty_country.dxcc_code, cty_country.continent


def resolve_country_and_continent(
    callsign: str,
    callsign_type: str,
) -> tuple[str, str]:
    cty_country = resolve_dxcc_entity(callsign, callsign_type)
    return cty_country.country, cty_country.continent


async def get_geo_details(
    valkey_client,
    qrz_session_key: str,
    callsign: str,
    geo_expiration: int,
    http_client,
    callsign_type,
) -> GeoData:
    # Get geo details from cache
    if valkey_client is not None:
        geo_data = await valkey_client.get(callsign)
    else:
        geo_data = None

    if geo_data:
        geo_data = json.loads(geo_data)
        cty_country = resolve_dxcc_entity(callsign, callsign_type)
        geo_data["dxcc_code"] = cty_country.dxcc_code
        geo_data["country"] = cty_country.country
        geo_data["continent"] = cty_country.continent
        geo_data["cached"] = True
        return GeoData(**geo_data)

    qrz_locator_dict = await get_locator_from_qrz(qrz_session_key, callsign, http_client)

    locator = qrz_locator_dict.get("locator")
    state = qrz_locator_dict.get("state")
    cq_zone = qrz_locator_dict.get("cq_zone")
    itu_zone = qrz_locator_dict.get("itu_zone")
    cty_country = None
    if locator:
        locator_source = "qrz"
    else:
        cty_country = _resolve_cty_entity(callsign)
        if (
            cty_country is not None
            and cty_country.latitude is not None
            and cty_country.longitude is not None
        ):
            locator = coordinates_to_locator(cty_country.latitude, cty_country.longitude)
            locator_source = "cty"
            cq_zone = cq_zone if cq_zone is not None else cty_country.cq_zone
            itu_zone = itu_zone if itu_zone is not None else cty_country.itu_zone
        else:
            raise GeoException(
                callsign,
                callsign_type,
                "locator",
                notify_monitor=cty_country is not None,
            )

    if cty_country is None:
        cty_country = resolve_dxcc_entity(callsign, callsign_type)
    lat, lon = locator_to_coordinates(locator)

    geo_data = {
        "locator_source": locator_source,
        "locator": locator,
        "lat": lat,
        "lon": lon,
        "dxcc_code": cty_country.dxcc_code,
        "country": cty_country.country,
        "continent": cty_country.continent,
        "state": state or "",
        "cq_zone": cq_zone,
        "itu_zone": itu_zone,
    }
    if valkey_client is not None:
        await valkey_client.set(callsign, json.dumps(geo_data), ex=geo_expiration)
    geo_data["cached"] = False

    return GeoData(**geo_data)
