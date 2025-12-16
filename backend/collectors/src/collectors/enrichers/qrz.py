import asyncio
import time
import httpx
import xml.etree.ElementTree as ET
from loguru import logger


def get_qrz_session_key(username: str, password: str, api_key: str):
    if username == "":
        raise ValueError("Username is empty")
    if password == "":
        raise ValueError("Password is empty")

    try:
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

    except Exception as ex:
        message = f"**** ERROR get_qrz_session_key **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.exception(message)
        return None


async def get_locator_from_qrz(qrz_session_key: str, callsign: str, delay: float = 0, debug: bool = False) -> dict:
    try:
        if debug:
            logger.debug(f"{callsign=}   {delay=}")
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
        if debug:
            logger.debug(f"{response=}")

        if response.status_code != 200:
            print("Error:", response.status_code)
            return {"locator": None, "error": f"qrz response code {response.status_code}"}

        if debug:
            logger.debug(f"{response.text=}")
        try:
            ns = {"qrz": "http://xmldata.qrz.com"}
            root = ET.fromstring(response.text)
            xml_error = root.find(".//qrz:Error", ns)
            if xml_error is not None:
                error = root.find(".//qrz:Error", ns).text
                if debug:
                    logger.debug(f"qrz.com: {error}")
                return {"locator": None, "error": error}

            geoloc = root.find(".//qrz:geoloc", ns).text
            if geoloc == "user":
                locator = root.find(".//qrz:grid", ns).text
                return {"locator": locator}
            else:
                return {"locator": None, "error": "no user supplied grid"}

        except Exception as e:
            return {"locator": None, "error": f"Exception: {e}"}
    except Exception as ex:
        message = f"**** ERROR get_locator_from_qrz **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
        logger.error(message)
        return {"locator": None, "error": f"Exception: {type(ex).__name__}"}
