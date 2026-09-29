import asyncio
import random
import xml.etree.ElementTree as ET

import httpx
from loguru import logger


QRZ_KEEPALIVE_EXPIRY_SECONDS = 1.0
HTTPX_DEFAULT_MAX_CONNECTIONS = 100
HTTPX_DEFAULT_MAX_KEEPALIVE_CONNECTIONS = 20
QRZ_XML_NAMESPACE = {"qrz": "http://xmldata.qrz.com"}
QRZ_REQUEST_ATTEMPTS = 6
QRZ_MAX_RETRY_DELAY_SECONDS = 30


async def _get_with_retries(http_client: httpx.AsyncClient, url: str, timeout: float | None = None):
    last_error = None
    for attempt in range(QRZ_REQUEST_ATTEMPTS):
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
            if attempt == QRZ_REQUEST_ATTEMPTS - 1:
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
        self.session_key = await get_qrz_session_key(
            username=self.username,
            password=self.password,
            api_key=self.api_key,
            http_client=self.http_client,
        )
        logger.info("QRZ session initialized")
        if self.redis_client:
            await self.redis_client.set(self.redis_key, self.session_key)

    async def aclose(self):
        await self.http_client.aclose()

    async def refresh_loop(self):
        try:
            while True:
                await asyncio.sleep(self.refresh_interval)
                logger.info(f"Refreshing QRZ key (every {self.refresh_interval} seconds)")
                try:
                    async with self._lock:
                        new_key = await get_qrz_session_key(
                            username=self.username,
                            password=self.password,
                            api_key=self.api_key,
                            http_client=self.http_client,
                        )
                        if new_key:
                            self.session_key = new_key
                            logger.info("QRZ session refreshed successfully")
                            if self.redis_client:
                                await self.redis_client.set(self.redis_key, new_key)
                        else:
                            logger.error("QRZ refresh failed (got None), keeping old key")
                except Exception:
                    logger.exception("Failed to refresh QRZ key. Keeping old key")
        except asyncio.CancelledError:
            logger.info("QRZ refresh task cancelled")

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


async def get_locator_from_qrz(qrz_session_key: str, callsign: str, http_client: httpx.AsyncClient) -> dict:
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

    response = await _get_with_retries(http_client, url, timeout=5)

    if response.status_code != 200:
        return _lookup_error(f"qrz response code {response.status_code}")

    try:
        root = ET.fromstring(response.text)
    except ET.ParseError as e:
        return _lookup_error(f"invalid qrz response XML: {e}")

    xml_error = _xml_text(root, "Error")
    if xml_error is not None:
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
