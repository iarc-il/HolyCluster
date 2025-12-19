import asyncio
import time
import httpx
import xml.etree.ElementTree as ET
from loguru import logger


class QrzSessionManager:
    def __init__(self, username: str, password: str, api_key: str, refresh_interval: int):
        self.username = username
        self.password = password
        self.api_key = api_key
        self.refresh_interval = refresh_interval
        self.session_key: str = ""
        self._lock = asyncio.Lock()

    async def start(self):
        self.session_key = get_qrz_session_key(
            username=self.username,
            password=self.password,
            api_key=self.api_key
        )
        logger.info("QRZ session initialized")

    async def refresh_loop(self):
        try:
            while True:
                await asyncio.sleep(self.refresh_interval)
                logger.info(f"Refreshing QRZ key (every {self.refresh_interval} seconds)")
                try:
                    async with self._lock:
                        new_key = get_qrz_session_key(
                            username=self.username,
                            password=self.password,
                            api_key=self.api_key
                        )
                        if new_key:
                            self.session_key = new_key
                            logger.info("QRZ session refreshed successfully")
                        else:
                            logger.error("QRZ refresh failed (got None), keeping old key")
                except Exception:
                    logger.exception("Failed to refresh QRZ key. Keeping old key")
        except asyncio.CancelledError:
            logger.info("QRZ refresh task cancelled")

    def get_key(self) -> str:
        return self.session_key


def get_qrz_session_key(username: str, password: str, api_key: str):
    if username == "":
        raise ValueError("Username is empty")
    if password == "":
        raise ValueError("Password is empty")

    attempts = 0
    while attempts <= 5:
        attempts += 1
        url = f"https://xmldata.qrz.com/xml/current/?username={username};password={password};agent=python:{api_key}"
        with httpx.Client() as client:
            response = client.get(url)

        if response.status_code == 200:
            root = ET.fromstring(response.text)
            ns = {"qrz": "http://xmldata.qrz.com"}
            session_key = root.find(".//qrz:Key", ns).text
            logger.info(f"Received QRZ key in {attempts=}")
            return session_key
        else:
            logger.error(f"**** Error: trying to get qrz session key {attempts=}: {response.status_code=}")
        time.sleep(5)
    logger.error(f"**** Error: stopped attempting to get QRZ key after {attempts=}")
    return None


async def get_locator_from_qrz(qrz_session_key: str, callsign: str, delay: float = 0) -> dict:
    suffix_list = ["/M", "/P"]
    for suffix in suffix_list:
        if callsign.upper().endswith(suffix):
            callsign = callsign[: -len(suffix)]
    if not qrz_session_key:
        return {"locator": None, "error": "No qrz_session_key"}
    await asyncio.sleep(delay)
    url = f"https://xmldata.qrz.com/xml/current/?s={qrz_session_key};callsign={callsign}"
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=30)

    if response.status_code != 200:
        print("Error:", response.status_code)
        return {"locator": None, "error": f"qrz response code {response.status_code}"}

    ns = {"qrz": "http://xmldata.qrz.com"}
    root = ET.fromstring(response.text)
    xml_error = root.find(".//qrz:Error", ns)
    if xml_error is not None:
        error = root.find(".//qrz:Error", ns).text
        return {"locator": None, "error": error}

    geoloc = root.find(".//qrz:geoloc", ns).text
    if geoloc == "user" or geoloc == "grid":
        locator = root.find(".//qrz:grid", ns).text
        return {"locator": locator}
    else:
        return {"locator": None, "error": "no user supplied grid"}
