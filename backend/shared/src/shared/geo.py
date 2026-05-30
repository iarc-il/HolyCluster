import csv
import json
import re
from pathlib import Path

from loguru import logger
from pydantic import BaseModel

from shared.coordinates import locator_to_coordinates
from shared.cty import get_cty_resolver
from shared.metrics import push_country_mismatch_event
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
    country: str
    continent: str
    state: str
    cq_zone: int | None = None
    itu_zone: int | None = None


def read_csv_to_list_of_tuples(filename: str):
    with open(filename, "r") as file:
        csv_reader = csv.reader(file)
        return [tuple(row) for row in csv_reader]


current_folder = Path(__file__).parent
callsign_to_locator_filename = f"{current_folder}/prefixes_list.csv"
PREFIXES_TO_LOCATORS = read_csv_to_list_of_tuples(filename=callsign_to_locator_filename)

_COUNTRY_NAME_ALIASES = {
    "agalegaandstbrandon": "agalegaandstbrandonislands",
    "asiaticturkey": "turkey",
    "bosniaherzegovina": "bosniaandherzegovina",
    "bouvet": "bouvetisland",
    "bruneidarussalam": "brunei",
    "demrepofthecongo": "democraticrepublicofthecongo",
    "dprofkorea": "northkorea",
    "fedrepofgermany": "germany",
    "kingdomofeswatini": "eswatini",
    "republicofkorea": "southkorea",
    "republicofkosovo": "kosovo",
    "republicofthecongo": "congo",
    "stlucia": "saintlucia",
    "stvincent": "saintvincentandthegrenadines",
    "sovmilorderofmalta": "sovereignmilitaryorderofmalta",
    "unitedstates": "unitedstatesofamerica",
    "usvirginislands": "virginislands",
}

_COUNTRY_OVERRIDES_BY_CALLSIGN = {
    "RI0SP": ("Asiatic Russia", "AS"),
}


def resolve_locator_from_list(callsign: str) -> str | None:
    callsign = callsign.upper()
    for regex, locator, country, continent in PREFIXES_TO_LOCATORS:
        if re.match(regex + ".*", callsign):
            return locator
    return None


def resolve_country_and_continent_from_list(callsign: str, callsign_type: str) -> tuple[str, str]:
    result = resolve_country_and_continent_from_prefix_list(callsign)
    if result is not None:
        return result
    raise GeoException(callsign, callsign_type, "country_and_continent")


def resolve_country_and_continent_from_prefix_list(callsign: str) -> tuple[str, str] | None:
    callsign = callsign.upper()
    for regex, locator, country, continent in PREFIXES_TO_LOCATORS:
        if re.match(regex + ".*", callsign):
            return country, continent
    return None


def _canonical_country_name(country: str) -> str:
    normalized = country.casefold().replace("&", "and")
    normalized = re.sub(r"[^a-z0-9]+", "", normalized)
    return _COUNTRY_NAME_ALIASES.get(normalized, normalized)


_PREFIX_LIST_COUNTRY_NAMES_BY_CANONICAL = {
    _canonical_country_name(country): country for regex, locator, country, continent in reversed(PREFIXES_TO_LOCATORS)
}


def _format_cty_country_for_output(cty_country: tuple[str, str]) -> tuple[str, str]:
    country, continent = cty_country
    return _PREFIX_LIST_COUNTRY_NAMES_BY_CANONICAL.get(_canonical_country_name(country), country), continent


def _country_results_disagree(
    cty_country: tuple[str, str] | None,
    prefix_list_country: tuple[str, str] | None,
) -> bool:
    if cty_country is None and prefix_list_country is None:
        return False
    if cty_country is None or prefix_list_country is None:
        return True

    cty_country_name, cty_continent = cty_country
    prefix_country_name, prefix_continent = prefix_list_country
    return (
        _canonical_country_name(cty_country_name) != _canonical_country_name(prefix_country_name)
        or cty_continent != prefix_continent
    )


def _resolve_cty_country(callsign: str) -> tuple[str, str] | None:
    callsign = callsign.upper()
    if callsign in _COUNTRY_OVERRIDES_BY_CALLSIGN:
        return _COUNTRY_OVERRIDES_BY_CALLSIGN[callsign]

    cty_resolver = get_cty_resolver()
    if cty_resolver is None:
        raise RuntimeError("CTY resolver is unavailable")
    return cty_resolver.resolve(callsign)


def _both_country_sources_miss(callsign: str) -> bool:
    cty_country = _resolve_cty_country(callsign)
    prefix_list_country = resolve_country_and_continent_from_prefix_list(callsign)
    return cty_country is None and prefix_list_country is None


async def _push_country_mismatch_if_needed(
    valkey_client,
    callsign: str,
    callsign_type: str,
    report_country_mismatch: bool,
    cty_country: tuple[str, str] | None,
    prefix_list_country: tuple[str, str] | None,
) -> None:
    if not report_country_mismatch or valkey_client is None:
        return
    if not _country_results_disagree(cty_country, prefix_list_country):
        return

    try:
        await push_country_mismatch_event(
            valkey_client,
            callsign,
            callsign_type,
            cty_country,
            prefix_list_country,
        )
    except Exception:
        logger.exception("Failed to push country mismatch event")


async def resolve_country_and_continent(
    valkey_client,
    callsign: str,
    callsign_type: str,
    report_country_mismatch: bool = False,
) -> tuple[str, str]:
    cty_country = _resolve_cty_country(callsign)
    prefix_list_country = resolve_country_and_continent_from_prefix_list(callsign)
    await _push_country_mismatch_if_needed(
        valkey_client,
        callsign,
        callsign_type,
        report_country_mismatch,
        cty_country,
        prefix_list_country,
    )

    if cty_country is not None:
        return _format_cty_country_for_output(cty_country)
    if prefix_list_country is not None:
        return prefix_list_country
    raise GeoException(
        callsign,
        callsign_type,
        "country_and_continent",
        notify_monitor=False,
    )


async def get_geo_details(
    valkey_client,
    qrz_session_key: str,
    callsign: str,
    geo_expiration: int,
    http_client,
    callsign_type,
    report_country_mismatch: bool = False,
) -> GeoData:
    # Get geo details from cache
    if valkey_client is not None:
        geo_data = await valkey_client.get(callsign)
    else:
        geo_data = None

    if geo_data:
        geo_data = json.loads(geo_data)
        country, continent = await resolve_country_and_continent(
            valkey_client, callsign, callsign_type, report_country_mismatch
        )
        geo_data["country"] = country
        geo_data["continent"] = continent
        geo_data["cached"] = True
        return GeoData(**geo_data)

    qrz_locator_dict = await get_locator_from_qrz(qrz_session_key, callsign, http_client)

    locator = qrz_locator_dict.get("locator")
    state = qrz_locator_dict.get("state")
    cq_zone = qrz_locator_dict.get("cq_zone")
    itu_zone = qrz_locator_dict.get("itu_zone")
    if locator:
        locator_source = "qrz"
    else:
        locator = resolve_locator_from_list(callsign)
        if locator:
            locator_source = "prefixes list"
        else:
            raise GeoException(
                callsign,
                callsign_type,
                "locator",
                notify_monitor=not _both_country_sources_miss(callsign),
            )

    country, continent = await resolve_country_and_continent(
        valkey_client, callsign, callsign_type, report_country_mismatch
    )
    lat, lon = locator_to_coordinates(locator)

    geo_data = {
        "locator_source": locator_source,
        "locator": locator,
        "lat": lat,
        "lon": lon,
        "country": country,
        "continent": continent,
        "state": state or "",
        "cq_zone": cq_zone,
        "itu_zone": itu_zone,
    }
    if valkey_client is not None:
        await valkey_client.set(callsign, json.dumps(geo_data), ex=geo_expiration)
    geo_data["cached"] = False

    return GeoData(**geo_data)
