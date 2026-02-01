#!/usr/bin/env python3
"""
DXpedition enricher for spot detection.
Fetches and caches active DXpeditions from NG3K ADXO XML feed.
"""

import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Optional

import httpx
from loguru import logger

ACTIVE_DXPEDITIONS: list[dict] = []

NG3K_XML_URL = "https://www.ng3k.com/adxo.xml"


def parse_date_range(date_str: str) -> Optional[tuple[datetime, datetime]]:
    """
    Parse date range from format like:
    - "Jan 1-Feb 16, 2026"
    - "Feb 7-14, 2026"
    - "Jan 1, 2026"

    Returns: (start_date, end_date) as datetime objects or None if parsing fails
    End date is set to 23:59:59 to include the full day
    """
    try:
        year_match = re.search(r",\s*(\d{4})", date_str)
        if not year_match:
            return None
        year = int(year_match.group(1))

        date_part = date_str[: year_match.start()].strip()

        if "-" in date_part:
            parts = date_part.split("-")
            start_part = parts[0].strip()
            end_part = parts[1].strip()

            start_date = datetime.strptime(f"{start_part} {year}", "%b %d %Y")
            start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)

            if any(
                month in end_part
                for month in ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            ):
                end_date = datetime.strptime(f"{end_part} {year}", "%b %d %Y")
            else:
                start_month = start_date.strftime("%b")
                end_date = datetime.strptime(f"{start_month} {end_part} {year}", "%b %d %Y")

                if end_date < start_date:
                    next_month = (start_date.month % 12) + 1
                    next_year = year if next_month > 1 else year + 1
                    end_date = datetime.strptime(f"{end_part} {next_month} {next_year}", "%d %m %Y")

            end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=timezone.utc)
        else:
            start_date = datetime.strptime(f"{date_part} {year}", "%b %d %Y")
            start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
            end_date = start_date.replace(hour=23, minute=59, second=59, microsecond=999999)

        return (start_date, end_date)
    except Exception as e:
        logger.debug(f"Failed to parse date range '{date_str}': {e}")
        return None


def parse_title(title: str) -> Optional[tuple[str, datetime, datetime]]:
    try:
        parts = [p.strip() for p in title.split("--")]

        if len(parts) < 2:
            return None

        location_date = parts[0]
        callsign = parts[1].strip()

        if ":" not in location_date:
            return None

        date_str = location_date.split(":", 1)[1].strip()

        dates = parse_date_range(date_str)
        if not dates:
            return None

        start_date, end_date = dates

        return (callsign, start_date, end_date)
    except Exception as e:
        logger.debug(f"Failed to parse title '{title}': {e}")
        return None


async def fetch_dxpedition_data() -> list[dict]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(NG3K_XML_URL)
        response.raise_for_status()
        xml_data = response.content

    root = ET.fromstring(xml_data)
    dxpeditions = []

    for item in root.findall(".//item"):
        title_elem = item.find("title")

        if title_elem is None or not title_elem.text:
            continue

        title = title_elem.text
        result = parse_title(title)

        if result:
            callsign, start_date, end_date = result
            dxpeditions.append({"callsign": callsign, "start_date": start_date, "end_date": end_date, "title": title})
        else:
            logger.error(f"Failed to parse dxpedition data: {title}")

    return dxpeditions


async def refresh_dxpedition_cache():
    global ACTIVE_DXPEDITIONS

    try:
        dxpeditions = await fetch_dxpedition_data()
        ACTIVE_DXPEDITIONS = dxpeditions
        logger.info(f"DXpedition cache refreshed with {len(dxpeditions)} entries:\n{dxpeditions}")
    except Exception as e:
        logger.error(f"Failed to refresh DXpedition cache: {e}")
        raise


def is_active_dxpedition(callsign: str) -> bool:
    if not callsign:
        return False

    now = datetime.now(timezone.utc)

    for dxpedition in ACTIVE_DXPEDITIONS:
        if dxpedition["callsign"].upper() == callsign.upper():
            is_active = dxpedition["start_date"] <= now <= dxpedition["end_date"]
            logger.info(f"Detected dxpedition: {callsign}")
            return is_active

    return False
