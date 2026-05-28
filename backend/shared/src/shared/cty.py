import json
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


@dataclass(frozen=True)
class CtyCacheResult:
    path: Path
    available: bool
    downloaded: bool
    message: str


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
