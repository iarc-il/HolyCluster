import asyncio
import random
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Callable

import httpx
from loguru import logger


QRZ_KEEPALIVE_EXPIRY_SECONDS = 1.0
HTTPX_DEFAULT_MAX_CONNECTIONS = 100
HTTPX_DEFAULT_MAX_KEEPALIVE_CONNECTIONS = 20
QRZ_XML_NAMESPACE = {"qrz": "http://xmldata.qrz.com"}
QRZ_REQUEST_ATTEMPTS = 6
QRZ_MAX_RETRY_DELAY_SECONDS = 30
QRZ_LOOKUP_BUDGET_SECONDS = 2.0
QRZ_AUTH_BUDGET_SECONDS = 10.0
QRZ_AUTH_RETRY_BASE_SECONDS = 5
QRZ_AUTH_RETRY_MAX_SECONDS = 60


async def _get_with_retries(
    http_client: httpx.AsyncClient, url: str, timeout: float | None = None, attempts: int = QRZ_REQUEST_ATTEMPTS
):
    last_error = None
    for attempt in range(attempts):
        try:
            if timeout is None:
                response = await http_client.get(url)
            else:
                response = await http_client.get(url, timeout=timeout)
            if response.status_code != 429 and response.status_code < 500:
                return response
            response.raise_for_status()
        except (httpx.TransportError, httpx.HTTPStatusError) as e:
            last_error = e
            if attempt == attempts - 1:
                raise
            delay = min(2**attempt, QRZ_MAX_RETRY_DELAY_SECONDS) + random.uniform(0, 1)
            logger.warning(
                f"QRZ request failed, retrying in {delay:.1f}s "
                f"({attempt + 1}/{QRZ_REQUEST_ATTEMPTS}): {type(e).__name__}"
            )
            await asyncio.sleep(delay)
    raise RuntimeError("QRZ request failed") from last_error


def _xml_text(root: ET.Element, tag_name: str) -> str | None:
    element = root.find(f".//qrz:{tag_name}", QRZ_XML_NAMESPACE)
    if element is None or element.text is None:
        return None
    value = element.text.strip()
    return value or None


def _lookup_error(message: str) -> dict:
    return {
        "locator": None,
        "state": None,
        "cq_zone": None,
        "itu_zone": None,
        "error": message,
    }


def _is_session_error(message: str) -> bool:
    normalized = message.lower()
    return "session" in normalized and any(value in normalized for value in ("expired", "invalid", "timeout"))


class QrzSessionManager:
    def __init__(
        self,
        username: str,
        password: str,
        api_key: str,
        refresh_interval: int,
        redis_client=None,
        redis_key: str = "qrz:session_key",
    ):
        self.username = username
        self.password = password
        self.api_key = api_key
        self.refresh_interval = refresh_interval
        self.session_key: str = ""
        self._lock = asyncio.Lock()
        self._retry_after = 0.0
        self.redis_client = redis_client
        self.redis_key = redis_key
        # QRZ's Apache endpoint advertises Keep-Alive timeout=2. Drop idle
        # connections sooner to avoid reusing sockets the server already closed.
        self.http_client = httpx.AsyncClient(
            limits=httpx.Limits(
                max_connections=HTTPX_DEFAULT_MAX_CONNECTIONS,
                max_keepalive_connections=HTTPX_DEFAULT_MAX_KEEPALIVE_CONNECTIONS,
                keepalive_expiry=QRZ_KEEPALIVE_EXPIRY_SECONDS,
            )
        )

    async def start(self):
        await self.refresh_if_stale(self.session_key)

    async def aclose(self):
        await self.http_client.aclose()

    async def refresh_if_stale(self, stale_key: str) -> str:
        async with self._lock:
            if self.session_key and self.session_key != stale_key:
                return self.session_key
            loop = asyncio.get_running_loop()
            if loop.time() < self._retry_after:
                raise RuntimeError("QRZ authentication temporarily unavailable")
            try:
                async with asyncio.timeout(QRZ_AUTH_BUDGET_SECONDS):
                    new_key = await get_qrz_session_key(
                        username=self.username,
                        password=self.password,
                        api_key=self.api_key,
                        http_client=self.http_client,
                    )
            except Exception:
                self._retry_after = loop.time() + QRZ_AUTH_RETRY_BASE_SECONDS
                raise
            self._retry_after = 0.0
            self.session_key = new_key
            if self.redis_client:
                await self.redis_client.set(self.redis_key, new_key)
            logger.info("QRZ session refreshed after lookup rejection")
            return new_key

    async def refresh_loop(self):
        # Authenticate in the background, including the first attempt at startup.
        retry_delay = QRZ_AUTH_RETRY_BASE_SECONDS
        while True:
            try:
                await self.start()
            except Exception:
                logger.warning("QRZ authentication unavailable; keeping collection active")
                await asyncio.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, QRZ_AUTH_RETRY_MAX_SECONDS)
            else:
                retry_delay = QRZ_AUTH_RETRY_BASE_SECONDS
                await asyncio.sleep(self.refresh_interval)

    def get_key(self) -> str:
        return self.session_key


async def get_qrz_session_key(username: str, password: str, api_key: str, http_client: httpx.AsyncClient):
    if username == "":
        raise ValueError("Username is empty")
    if password == "":
        raise ValueError("Password is empty")

    url = f"https://xmldata.qrz.com/xml/current/?username={username};password={password};agent=python:{api_key}"
    response = await _get_with_retries(http_client, url)
    if response.status_code != 200:
        raise RuntimeError(f"QRZ session request failed with status {response.status_code}")

    try:
        root = ET.fromstring(response.text)
    except ET.ParseError as e:
        raise RuntimeError("QRZ session response contained invalid XML") from e

    session_key = _xml_text(root, "Key")
    if session_key is None:
        error = _xml_text(root, "Error") or "response did not contain a key"
        raise RuntimeError(f"QRZ session request failed: {error}")
    logger.info("Received QRZ key")
    return session_key


async def get_locator_from_qrz(
    qrz_session_key: str,
    callsign: str,
    http_client: httpx.AsyncClient,
    refresh_session: Callable[[str], Awaitable[str]] | None = None,
) -> dict:
    # One deadline covers HTTP, lock waiting, authentication and the second lookup.
    try:
        async with asyncio.timeout(QRZ_LOOKUP_BUDGET_SECONDS):
            return await _get_locator_from_qrz(qrz_session_key, callsign, http_client, refresh_session)
    except (httpx.HTTPError, TimeoutError, RuntimeError) as e:
        return _lookup_error(f"qrz request unavailable: {type(e).__name__}")


async def _get_locator_from_qrz(
    qrz_session_key: str,
    callsign: str,
    http_client: httpx.AsyncClient,
    refresh_session: Callable[[str], Awaitable[str]] | None = None,
) -> dict:
    def parse_zone_int(root, ns, tag_name):
        elem = root.find(f".//qrz:{tag_name}", ns)
        if elem is None or elem.text is None:
            return None
        text = elem.text.strip()
        if text == "":
            return None
        try:
            return int(text)
        except ValueError:
            return None

    suffix_list = ["/M", "/P"]
    for suffix in suffix_list:
        if callsign.upper().endswith(suffix):
            callsign = callsign[: -len(suffix)]
    if not qrz_session_key:
        return _lookup_error("No qrz_session_key")

    url = f"https://xmldata.qrz.com/xml/current/?s={qrz_session_key};callsign={callsign}"

    try:
        response = await _get_with_retries(http_client, url, timeout=QRZ_LOOKUP_BUDGET_SECONDS, attempts=1)
    except (httpx.TransportError, httpx.HTTPStatusError) as e:
        return _lookup_error(f"qrz request unavailable: {type(e).__name__}")

    if response.status_code != 200:
        return _lookup_error(f"qrz response code {response.status_code}")

    try:
        root = ET.fromstring(response.text)
    except ET.ParseError as e:
        return _lookup_error(f"invalid qrz response XML: {e}")

    xml_error = _xml_text(root, "Error")
    if xml_error is not None:
        if refresh_session is not None and _is_session_error(xml_error):
            refreshed_key = await refresh_session(qrz_session_key)
            return await _get_locator_from_qrz(refreshed_key, callsign, http_client)
        return _lookup_error(xml_error)

    geoloc = _xml_text(root, "geoloc")
    if geoloc is None:
        return _lookup_error("qrz response did not contain geoloc")
    if geoloc == "none":
        return _lookup_error("no user supplied grid")

    locator = _xml_text(root, "grid")
    if locator is None:
        return _lookup_error("qrz response did not contain grid")

    state = _xml_text(root, "state")
    cq_zone = parse_zone_int(root, QRZ_XML_NAMESPACE, "cqzone")
    itu_zone = parse_zone_int(root, QRZ_XML_NAMESPACE, "ituzone")
    return {"locator": locator, "state": state, "cq_zone": cq_zone, "itu_zone": itu_zone}
