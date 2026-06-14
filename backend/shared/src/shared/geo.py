import csv
import json
import re
from pathlib import Path

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
    "amsterdamandstpaulis": "amsterdamandstpaulislands",
    "asiaticturkey": "turkey",
    "bosniaherzegovina": "bosniaandherzegovina",
    "bouvet": "bouvetisland",
    "bruneidarussalam": "brunei",
    "congodemrepublicof": "democraticrepublicofthecongo",
    "cotedivoire": "ivorycoast",
    "demrepofthecongo": "democraticrepublicofthecongo",
    "dprofkorea": "northkorea",
    "fedrepofgermany": "germany",
    "juandenovaisland": "juandenovaandeuropa",
    "kingdomofeswatini": "eswatini",
    "nzsubantarcticis": "newzealandsubantarcticislands",
    "republicofkorea": "southkorea",
    "republicofkosovo": "kosovo",
    "republicofsouthsudan": "southsudan",
    "republicofthecongo": "congo",
    "southgeorgiaislands": "southgeorgiaisland",
    "stbarthelemy": "saintbarthelemy",
    "stlucia": "saintlucia",
    "stmaarten": "sintmaarten",
    "stmartin": "saintmartin",
    "stpierreandmiquelon": "saintpierreandmiquelon",
    "stvincent": "saintvincentandthegrenadines",
    "sovmilorderofmalta": "sovereignmilitaryorderofmalta",
    "ukbaseareasoncyprus": "uksovereignbaseareasoncyprus",
    "usa": "unitedstatesofamerica",
    "unitedstates": "unitedstatesofamerica",
    "usvirginislands": "virginislands",
}

_COUNTRY_OVERRIDES_BY_CALLSIGN = {
    "2R0PLA": ("England", "EU"),
    "4U5ITU": ("ITU HQ", "EU"),
    "BB4IA": ("China", "AS"),
    "BB4TVU": ("China", "AS"),
    "KH7X": ("Hawaii", "OC"),
    "KL2A": ("Alaska", "NA"),
    "NL5Y": ("Alaska", "NA"),
    "R95WTA": ("Asiatic Russia", "AS"),
    "RP2F": ("Kaliningrad", "EU"),
    "RI0SP": ("Asiatic Russia", "AS"),
    "T94A": ("Bosnia and Herzegovina", "EU"),
    "T9BLB/IH9": ("Bosnia and Herzegovina", "EU"),
    "VD9WH": ("Canada", "NA"),
    "VO/DF6MS": ("Canada", "NA"),
    "VO3A": ("Canada", "NA"),
    "VQ0X": ("Turks and Caicos Islands", "NA"),
    "VS6AI": ("Hong Kong", "AS"),
    "YZ5W": ("Serbia", "EU"),
}

_COUNTRY_OVERRIDES_BY_PREFIX = {
    "BE": ("China", "AS"),
    "DP0": ("Antarctica", "AN"),
    "EA9": ("Ceuta and Melilla", "AF"),
    "JD/": ("Ogasawara", "AS"),
    "VO0": ("Canada", "NA"),
}


def resolve_locator_from_list(callsign: str) -> str | None:
    callsign = callsign.upper()
    for regex, locator, country, continent in PREFIXES_TO_LOCATORS:
        if re.match(regex + ".*", callsign):
            return locator
    return None


def _resolve_cty_country_details(callsign: str) -> CtyCountry | None:
    cty_resolver = get_cty_resolver()
    if cty_resolver is None:
        raise RuntimeError("CTY resolver is unavailable")
    return cty_resolver.resolve_country(callsign)


def _resolve_locator_from_cty(callsign: str) -> tuple[str, int | None, int | None] | None:
    cty_country = _resolve_cty_country_details(callsign)
    if cty_country is None or cty_country.latitude is None or cty_country.longitude is None:
        return None
    return (
        coordinates_to_locator(cty_country.latitude, cty_country.longitude),
        cty_country.cq_zone,
        cty_country.itu_zone,
    )


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
    for prefix, country in _COUNTRY_OVERRIDES_BY_PREFIX.items():
        if callsign.startswith(prefix):
            return country

    cty_country = _resolve_cty_country_details(callsign)
    if cty_country is None:
        return None
    return cty_country.country, cty_country.continent


def _cty_country_misses(callsign: str) -> bool:
    return _resolve_cty_country(callsign) is None


def resolve_country_and_continent(
    callsign: str,
    callsign_type: str,
) -> tuple[str, str]:
    cty_country = _resolve_cty_country(callsign)
    if cty_country is not None:
        return cty_country
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
) -> GeoData:
    # Get geo details from cache
    if valkey_client is not None:
        geo_data = await valkey_client.get(callsign)
    else:
        geo_data = None

    if geo_data:
        geo_data = json.loads(geo_data)
        country, continent = resolve_country_and_continent(callsign, callsign_type)
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
        cty_locator = _resolve_locator_from_cty(callsign)
        if cty_locator is not None:
            locator, cty_cq_zone, cty_itu_zone = cty_locator
            locator_source = "cty"
            cq_zone = cq_zone if cq_zone is not None else cty_cq_zone
            itu_zone = itu_zone if itu_zone is not None else cty_itu_zone
        else:
            locator = resolve_locator_from_list(callsign)
            if locator:
                locator_source = "prefixes list"
            else:
                raise GeoException(
                    callsign,
                    callsign_type,
                    "locator",
                    notify_monitor=not _cty_country_misses(callsign),
                )

    country, continent = resolve_country_and_continent(callsign, callsign_type)
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
