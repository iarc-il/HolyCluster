import asyncio
import xml.etree.ElementTree as ET

import httpx
from loguru import logger


QRZ_KEEPALIVE_EXPIRY_SECONDS = 1.0
HTTPX_DEFAULT_MAX_CONNECTIONS = 100
HTTPX_DEFAULT_MAX_KEEPALIVE_CONNECTIONS = 20


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

    attempts = 0
    while attempts <= 5:
        attempts += 1
        url = f"https://xmldata.qrz.com/xml/current/?username={username};password={password};agent=python:{api_key}"
        try:
            response = await http_client.get(url)
        except httpx.TransportError as e:
            raise type(e)(f"xmldata.qrz.com: {e}") from e

        if response.status_code == 200:
            root = ET.fromstring(response.text)
            ns = {"qrz": "http://xmldata.qrz.com"}
            session_key = root.find(".//qrz:Key", ns).text
            logger.info(f"Received QRZ key in {attempts=}")
            return session_key
        else:
            logger.error(f"**** Error: trying to get qrz session key {attempts=}: {response.status_code=}")
        await asyncio.sleep(5)
    logger.error(f"**** Error: stopped attempting to get QRZ key after {attempts=}")
    return None


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
        return {
            "locator": None,
            "state": None,
            "cq_zone": None,
            "itu_zone": None,
            "error": "No qrz_session_key",
        }

    url = f"https://xmldata.qrz.com/xml/current/?s={qrz_session_key};callsign={callsign}"

    retries = 0
    response = None
    max_retries = 5
    while response is None:
        try:
            response = await http_client.get(url, timeout=5)
            response.raise_for_status()
        except httpx.TimeoutException as e:
            if retries == max_retries:
                raise type(e)(f"xmldata.qrz.com timeout: {e}") from e
            else:
                logger.warning("Timeout error, retrying")
                retries += 1
        except httpx.NetworkError as e:
            if retries == max_retries:
                raise type(e)(f"xmldata.qrz.com network: {e}") from e
            else:
                logger.warning("Network error, retrying")
                retries += 1
        except httpx.ProtocolError as e:
            if retries == max_retries:
                raise type(e)(f"xmldata.qrz.com protocol: {e}") from e
            else:
                logger.warning(f"Protocol error, retrying ({retries + 1}/{max_retries}): {type(e).__name__}: {e}")
                retries += 1
        except httpx.ProxyError as e:
            if retries == max_retries:
                raise type(e)(f"xmldata.qrz.com proxy: {e}") from e
            else:
                logger.warning("Proxy error, retrying")
                retries += 1
        except httpx.UnsupportedProtocol as e:
            if retries == max_retries:
                raise type(e)(f"xmldata.qrz.com unsupported protocol: {e}") from e
            else:
                logger.warning("Unsupported protocol error, retrying")
                retries += 1
        except httpx.TransportError as e:
            if retries == max_retries:
                raise type(e)(f"xmldata.qrz.com transport: {e}") from e
            else:
                logger.warning("Transport error, retrying")
                retries += 1

    if response.status_code != 200:
        return {
            "locator": None,
            "state": None,
            "cq_zone": None,
            "itu_zone": None,
            "error": f"qrz response code {response.status_code}",
        }

    ns = {"qrz": "http://xmldata.qrz.com"}
    root = ET.fromstring(response.text)
    xml_error = root.find(".//qrz:Error", ns)
    if xml_error is not None:
        error = root.find(".//qrz:Error", ns).text
        return {
            "locator": None,
            "state": None,
            "cq_zone": None,
            "itu_zone": None,
            "error": error,
        }

    geoloc = root.find(".//qrz:geoloc", ns).text
    if geoloc != "none":
        locator = root.find(".//qrz:grid", ns).text
        state_elem = root.find(".//qrz:state", ns)
        state = state_elem.text if state_elem is not None else None
        cq_zone = parse_zone_int(root, ns, "cqzone")
        itu_zone = parse_zone_int(root, ns, "ituzone")
        return {"locator": locator, "state": state, "cq_zone": cq_zone, "itu_zone": itu_zone}
    else:
        return {
            "locator": None,
            "state": None,
            "cq_zone": None,
            "itu_zone": None,
            "error": "no user supplied grid",
        }
