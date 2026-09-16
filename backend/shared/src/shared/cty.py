import csv
import io
import re
from dataclasses import dataclass
from pathlib import Path

import httpx
from loguru import logger


CTY_PATH = Path(__file__).with_name("cty.csv")
CTY_COUNTRY_FIELD_INDEX = 1
CTY_DXCC_FIELD_INDEX = 2
CTY_CONTINENT_FIELD_INDEX = 3
CTY_CQ_ZONE_FIELD_INDEX = 4
CTY_ITU_ZONE_FIELD_INDEX = 5
CTY_LATITUDE_FIELD_INDEX = 6
CTY_LONGITUDE_FIELD_INDEX = 7
CTY_ALIAS_FIELD_INDEX = 9

_CTY_TOKEN_MODIFIER_RE = re.compile(r"\(\d+\)|\[\d+\]|<[^>]+>|\{[^}]+}|~[^~]+~")
_CTY_RESOLVER: "CtyResolver | None" = None
_CTY_RESOLVER_PATH: Path | None = None
_CTY_RESOLVER_MTIME: float | None = None


@dataclass(frozen=True)
class CtyCountry:
    country: str
    continent: str
    dxcc_code: int
    latitude: float | None
    longitude: float | None
    cq_zone: int | None
    itu_zone: int | None


@dataclass(frozen=True)
class CtyResolver:
    exact_callsigns: dict[str, CtyCountry]
    prefixes: dict[str, CtyCountry]
    entities_by_dxcc_code: dict[int, CtyCountry]

    def resolve_entity(self, callsign: str) -> CtyCountry | None:
        normalized = normalize_callsign(callsign)
        if not normalized:
            return None

        entity = self.exact_callsigns.get(normalized)
        if entity is not None:
            return entity

        for end in range(len(normalized), 0, -1):
            entity = self.prefixes.get(normalized[:end])
            if entity is not None:
                return entity

        return None

    def resolve_country(self, callsign: str) -> CtyCountry | None:
        return self.resolve_entity(callsign)

    def resolve(self, callsign: str) -> tuple[int, str] | None:
        entity = self.resolve_entity(callsign)
        if entity is None:
            return None
        return entity.dxcc_code, entity.continent

    def resolve_country_and_continent(self, callsign: str) -> tuple[str, str] | None:
        entity = self.resolve_entity(callsign)
        if entity is None:
            return None
        return entity.country, entity.continent

    def get_entity_by_dxcc_code(self, dxcc_code: int) -> CtyCountry | None:
        return self.entities_by_dxcc_code.get(dxcc_code)


def normalize_callsign(callsign: str) -> str:
    return callsign.strip().upper()


def _clean_cty_token(raw_token: str) -> tuple[bool, str] | None:
    token = raw_token.strip().strip(",;")
    if not token:
        return None

    exact = token.startswith("=")
    if exact:
        token = token[1:]

    token = token.lstrip("*")
    token = _CTY_TOKEN_MODIFIER_RE.sub("", token).strip().upper()
    if not token:
        return None

    return exact, token


def _iter_cty_tokens(row: list[str]) -> list[tuple[bool, str]]:
    raw_tokens = [row[0]]
    raw_tokens.extend(" ".join(row[CTY_ALIAS_FIELD_INDEX:]).split())

    tokens = []
    for raw_token in raw_tokens:
        token = _clean_cty_token(raw_token)
        if token is not None:
            tokens.append(token)
    return tokens


def _parse_optional_int(value: str) -> int | None:
    value = value.strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _parse_dxcc_code(value: str) -> int | None:
    dxcc_code = _parse_optional_int(value)
    if dxcc_code is None or dxcc_code <= 0:
        return None
    return dxcc_code


def _parse_optional_float(value: str) -> float | None:
    value = value.strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _normal_longitude_from_cty(value: str) -> float | None:
    longitude = _parse_optional_float(value)
    if longitude is None:
        return None
    return -longitude


def _build_canonical_countries_by_dxcc(rows: list[list[str]]) -> dict[int, str]:
    canonical_countries = {}
    for row in rows:
        if len(row) <= CTY_ALIAS_FIELD_INDEX:
            continue

        primary_prefix = row[0].strip()
        dxcc_code = _parse_dxcc_code(row[CTY_DXCC_FIELD_INDEX])
        country = row[CTY_COUNTRY_FIELD_INDEX].strip()
        if primary_prefix.startswith("*") or not dxcc_code or not country:
            continue

        canonical_countries.setdefault(dxcc_code, country)

    return canonical_countries


def build_cty_resolver(rows: list[list[str]]) -> CtyResolver:
    exact_callsigns: dict[str, CtyCountry] = {}
    prefixes: dict[str, CtyCountry] = {}
    entities_by_dxcc_code: dict[int, CtyCountry] = {}
    canonical_countries_by_dxcc = _build_canonical_countries_by_dxcc(rows)

    for row in rows:
        if len(row) <= CTY_ALIAS_FIELD_INDEX:
            logger.warning(f"Skipping malformed CTY row: {row}")
            continue

        primary_prefix = row[0].strip()
        dxcc_code = _parse_dxcc_code(row[CTY_DXCC_FIELD_INDEX])
        country = row[CTY_COUNTRY_FIELD_INDEX].strip()
        continent = row[CTY_CONTINENT_FIELD_INDEX].strip().upper()
        if dxcc_code is None:
            logger.warning(f"Skipping CTY row with invalid DXCC code: {row}")
            continue
        if not country or not continent:
            logger.warning(f"Skipping CTY row with missing country or continent: {row}")
            continue

        if primary_prefix.startswith("*"):
            country = canonical_countries_by_dxcc.get(dxcc_code, country)

        cty_country = CtyCountry(
            country=country,
            continent=continent,
            dxcc_code=dxcc_code,
            latitude=_parse_optional_float(row[CTY_LATITUDE_FIELD_INDEX]),
            longitude=_normal_longitude_from_cty(row[CTY_LONGITUDE_FIELD_INDEX]),
            cq_zone=_parse_optional_int(row[CTY_CQ_ZONE_FIELD_INDEX]),
            itu_zone=_parse_optional_int(row[CTY_ITU_ZONE_FIELD_INDEX]),
        )
        if not primary_prefix.startswith("*"):
            entities_by_dxcc_code.setdefault(dxcc_code, cty_country)
        for exact, token in _iter_cty_tokens(row):
            if exact:
                exact_callsigns.setdefault(token, cty_country)
            else:
                prefixes.setdefault(token, cty_country)

    return CtyResolver(
        exact_callsigns=exact_callsigns,
        prefixes=prefixes,
        entities_by_dxcc_code=entities_by_dxcc_code,
    )


def load_cty_resolver(path: Path = CTY_PATH) -> CtyResolver:
    with path.open(newline="") as file:
        rows = list(csv.reader(file))

    resolver = build_cty_resolver(rows)
    logger.info(
        f"Loaded CTY resolver from {path}: "
        f"{len(resolver.exact_callsigns)} exact callsigns, {len(resolver.prefixes)} prefixes"
    )
    return resolver


def get_cty_resolver(path: Path = CTY_PATH) -> CtyResolver | None:
    global _CTY_RESOLVER, _CTY_RESOLVER_MTIME, _CTY_RESOLVER_PATH

    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        if _CTY_RESOLVER is not None and _CTY_RESOLVER_PATH == path:
            return _CTY_RESOLVER
        return None

    if _CTY_RESOLVER is not None and _CTY_RESOLVER_PATH == path and _CTY_RESOLVER_MTIME == mtime:
        return _CTY_RESOLVER

    _CTY_RESOLVER = load_cty_resolver(path)
    _CTY_RESOLVER_PATH = path
    _CTY_RESOLVER_MTIME = mtime
    return _CTY_RESOLVER


def resolve_country_from_cty(callsign: str, path: Path = CTY_PATH) -> tuple[str, str] | None:
    resolver = get_cty_resolver(path)
    if resolver is None:
        return None
    return resolver.resolve_country_and_continent(callsign)


def resolve_dxcc_from_cty(callsign: str, path: Path = CTY_PATH) -> tuple[int, str] | None:
    resolver = get_cty_resolver(path)
    if resolver is None:
        return None
    return resolver.resolve(callsign)


async def ensure_cty_available(http_client: httpx.AsyncClient | None = None) -> CtyResolver:
    del http_client

    try:
        _validate_cty_cache(CTY_PATH)
    except (OSError, ValueError) as e:
        raise RuntimeError(f"Committed CTY file is unavailable: {CTY_PATH}") from e

    resolver = get_cty_resolver()
    if resolver is None:
        raise RuntimeError(f"CTY resolver is unavailable: {CTY_PATH}")
    return resolver


def _validate_cty_content(content: bytes) -> None:
    try:
        rows = csv.reader(io.StringIO(content.decode("utf-8-sig")))
        for row in rows:
            if (
                len(row) > CTY_ALIAS_FIELD_INDEX
                and _parse_dxcc_code(row[CTY_DXCC_FIELD_INDEX]) is not None
                and row[CTY_COUNTRY_FIELD_INDEX].strip()
                and re.fullmatch(r"[A-Za-z]{2}", row[CTY_CONTINENT_FIELD_INDEX].strip())
            ):
                return
    except (csv.Error, UnicodeDecodeError) as e:
        raise ValueError("downloaded CTY file is not valid UTF-8 CSV") from e

    raise ValueError("downloaded CTY file contains no CTY records")


def _validate_cty_response(response: httpx.Response) -> None:
    content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type in {"text/html", "application/xhtml+xml"}:
        raise ValueError(f"downloaded CTY file is HTML ({content_type})")
    _validate_cty_content(response.content)


def _validate_cty_cache(cache_path: Path) -> None:
    _validate_cty_content(cache_path.read_bytes())


async def _get_cty_file(
    url: str,
    headers: dict[str, str],
    timeout: float,
    http_client: httpx.AsyncClient | None,
) -> httpx.Response:
    if http_client is not None:
        return await http_client.get(url, headers=headers, timeout=timeout, follow_redirects=True)

    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.get(url, headers=headers, follow_redirects=True)
