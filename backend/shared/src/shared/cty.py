import csv
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from loguru import logger


CTY_URL = "https://www.country-files.com/cty/cty.csv"
CTY_CACHE_DIR = Path.home() / ".cache" / "holycluster" / "country-files"
CTY_CACHE_PATH = CTY_CACHE_DIR / "cty.csv"
CTY_METADATA_PATH = CTY_CACHE_DIR / "cty_metadata.json"
CTY_REFRESH_TIMEOUT = 30.0
CTY_ALIAS_FIELD_INDEX = 9

_CTY_TOKEN_MODIFIER_RE = re.compile(r"\(\d+\)|\[\d+\]|<[^>]+>|\{[^}]+}|~[^~]+~")
_CTY_RESOLVER: "CtyResolver | None" = None
_CTY_RESOLVER_PATH: Path | None = None
_CTY_RESOLVER_MTIME: float | None = None


@dataclass(frozen=True)
class CtyCacheResult:
    path: Path
    available: bool
    downloaded: bool
    message: str


@dataclass(frozen=True)
class CtyCountry:
    country: str
    continent: str


@dataclass(frozen=True)
class CtyResolver:
    exact_callsigns: dict[str, CtyCountry]
    prefixes: dict[str, CtyCountry]

    def resolve(self, callsign: str) -> tuple[str, str] | None:
        normalized = normalize_callsign(callsign)
        if not normalized:
            return None

        country = self.exact_callsigns.get(normalized)
        if country is not None:
            return country.country, country.continent

        for end in range(len(normalized), 0, -1):
            country = self.prefixes.get(normalized[:end])
            if country is not None:
                return country.country, country.continent

        return None


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


def build_cty_resolver(rows: list[list[str]]) -> CtyResolver:
    exact_callsigns: dict[str, CtyCountry] = {}
    prefixes: dict[str, CtyCountry] = {}

    for row in rows:
        if len(row) <= CTY_ALIAS_FIELD_INDEX:
            logger.warning(f"Skipping malformed CTY row: {row}")
            continue

        country = row[1].strip()
        continent = row[3].strip().upper()
        if not country or not continent:
            logger.warning(f"Skipping CTY row with missing country or continent: {row}")
            continue

        cty_country = CtyCountry(country=country, continent=continent)
        for exact, token in _iter_cty_tokens(row):
            if exact:
                exact_callsigns.setdefault(token, cty_country)
            else:
                prefixes.setdefault(token, cty_country)

    return CtyResolver(exact_callsigns=exact_callsigns, prefixes=prefixes)


def load_cty_resolver(path: Path = CTY_CACHE_PATH) -> CtyResolver:
    with path.open(newline="") as file:
        rows = list(csv.reader(file))

    resolver = build_cty_resolver(rows)
    logger.info(
        f"Loaded CTY resolver from {path}: "
        f"{len(resolver.exact_callsigns)} exact callsigns, {len(resolver.prefixes)} prefixes"
    )
    return resolver


def get_cty_resolver(path: Path = CTY_CACHE_PATH) -> CtyResolver | None:
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


def resolve_country_from_cty(callsign: str, path: Path = CTY_CACHE_PATH) -> tuple[str, str] | None:
    resolver = get_cty_resolver(path)
    if resolver is None:
        return None
    return resolver.resolve(callsign)


async def ensure_cty_available(http_client: httpx.AsyncClient | None = None) -> CtyResolver:
    cache_result = await refresh_cty_cache(http_client=http_client)
    if not cache_result.available:
        raise RuntimeError(f"CTY file is unavailable: {cache_result.message}")

    resolver = get_cty_resolver()
    if resolver is None:
        raise RuntimeError(f"CTY resolver is unavailable: {cache_result.path}")
    return resolver


def _read_metadata(metadata_path: Path) -> dict[str, Any]:
    if not metadata_path.exists():
        return {}

    try:
        return json.loads(metadata_path.read_text())
    except json.JSONDecodeError:
        logger.warning(f"Ignoring invalid CTY cache metadata: {metadata_path}")
        return {}


def _conditional_headers(cache_path: Path, metadata: dict[str, Any]) -> dict[str, str]:
    if not cache_path.exists():
        return {}

    headers = {}
    if metadata.get("etag"):
        headers["If-None-Match"] = metadata["etag"]
    if metadata.get("last_modified"):
        headers["If-Modified-Since"] = metadata["last_modified"]
    return headers


def _write_metadata(metadata_path: Path, response: httpx.Response, url: str) -> None:
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata = {
        "url": url,
        "etag": response.headers.get("etag"),
        "last_modified": response.headers.get("last-modified"),
        "content_length": len(response.content),
        "downloaded_at": time.time(),
    }
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")


async def _get_cty_file(
    url: str,
    headers: dict[str, str],
    timeout: float,
    http_client: httpx.AsyncClient | None,
) -> httpx.Response:
    if http_client is not None:
        return await http_client.get(url, headers=headers, timeout=timeout)

    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.get(url, headers=headers)


async def refresh_cty_cache(
    http_client: httpx.AsyncClient | None = None,
) -> CtyCacheResult:
    cache_path = CTY_CACHE_PATH
    metadata_path = CTY_METADATA_PATH
    metadata = _read_metadata(metadata_path)
    headers = _conditional_headers(cache_path, metadata)

    try:
        response = await _get_cty_file(CTY_URL, headers, CTY_REFRESH_TIMEOUT, http_client)
        if response.status_code == 304 and cache_path.exists():
            logger.info(f"CTY cache is current: {cache_path}")
            return CtyCacheResult(
                path=cache_path,
                available=True,
                downloaded=False,
                message="cache is current",
            )

        response.raise_for_status()
        if not response.content.strip():
            raise ValueError("downloaded CTY file is empty")

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = cache_path.with_name(f"{cache_path.name}.tmp")
        tmp_path.write_bytes(response.content)
        tmp_path.replace(cache_path)
        _write_metadata(metadata_path, response, CTY_URL)

        logger.info(f"Downloaded CTY file to {cache_path}")
        return CtyCacheResult(
            path=cache_path,
            available=True,
            downloaded=True,
            message="downloaded",
        )
    except Exception as e:
        if cache_path.exists():
            logger.exception(f"Failed to refresh CTY cache from {CTY_URL}; using cached file {cache_path}")
            return CtyCacheResult(
                path=cache_path,
                available=True,
                downloaded=False,
                message=f"using cached file after refresh failure: {e}",
            )

        logger.exception(f"Failed to refresh CTY cache from {CTY_URL}; no cached file is available")
        return CtyCacheResult(
            path=cache_path,
            available=False,
            downloaded=False,
            message=f"no CTY file available after refresh failure: {e}",
        )
