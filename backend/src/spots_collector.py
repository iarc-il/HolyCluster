from datetime import datetime, timezone
# import asyncio
import json
import re
from loguru import logger
import httpx

from db_classes import DxheatRaw, HolySpot, GeoCache
from location import resolve_locator, resolve_country_and_continent, locator_to_coordinates
from qrz import get_locator_from_qrz

from settings import (
    FT8_HF_FREQUENCIES,
    FT4_HF_FREQUENCIES
)


async def get_dxheat_spots(band:int, limit:int=30, debug:bool=False) -> list|None:
    assert isinstance(band, int)
    assert isinstance(limit, int)
    limit = min(50, limit)

    url = f"https://dxheat.com/source/spots/?a={limit}&b={band}&cdx=EU&cdx=NA&cdx=SA&cdx=AS&cdx=AF&cdx=OC&cdx=AN&cde=EU&cde=NA&cde=SA&cde=AS&cde=AF&cde=OC&cde=AN&m=CW&m=PHONE&m=DIGI&valid=1&spam=0"
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=15)
    if debug:
        logger.debug(f"{response.content}")

    # Check if request was successful
    if response.status_code == 200:
        if debug:
            logger.debug(f"band={band}, limit={limit}")
        # Parse JSON string to a Python list
        spots = []
        for spot in json.loads(response.content):
            if debug:
                logger.debug(f"spot={spot}")
            spots.append(spot)
        return spots
    else:
        return []


def prepare_dxheat_record(spot, debug=False):
    time = datetime.strptime(spot['Time'], '%H:%M').time()
    date = datetime.strptime(spot['Date'], '%d/%m/%y').date() 
    record = DxheatRaw(
        number=spot['Nr'],
        spotter=spot['Spotter'],
        frequency=spot['Frequency'],
        dx_call=spot['DXCall'],
        time=time,
        date=date,
        date_time=datetime.combine(date, time, tzinfo=timezone.utc),
        beacon=spot['Beacon'],
        mm=spot['MM'],
        am=spot['AM'],
        valid=spot['Valid'],
        lotw=spot['LOTW'] if 'LOTW' in spot else None,
        lotw_date=datetime.strptime(spot['LOTW_Date'], '%m/%d/%Y').date() if 'LOTW_Date' in spot else None,
        esql=spot['EQSL'] if 'EQSL' in spot else None,
        dx_homecall=spot['DXHomecall'],
        comment=spot['Comment'],
        flag=spot.get('Flag'),
        band=str(spot['Band']),
        mode=spot['Mode'],
        continent_dx=spot.get('Continent_dx'),
        continent_spotter=spot['Continent_spotter'],
        dx_locator=spot['DXLocator']
    )

    return record


async def prepare_holy_spot(
    date,
    time,
    mode: str,
    band: str,
    frequency: str,
    spotter_callsign: str,
    dx_callsign: str,
    dx_locator: str,
    comment: str,
    qrz_session_key: str,
    geo_cache_spotter: dict,
    geo_cache_dx: dict,
    delay: float = 0,
    debug: bool = False
):

    if  geo_cache_spotter:
        spotter_locator = geo_cache_spotter["locator"]
        spotter_lat = geo_cache_spotter["lat"]
        spotter_lon = geo_cache_spotter["lon"]
        spotter_country = geo_cache_spotter["country"]
        spotter_continent = geo_cache_spotter["continent"]
    else:
        spotter_locator = await get_locator_from_qrz(
            qrz_session_key=qrz_session_key, 
            callsign=spotter_callsign,
            delay=delay, 
            debug=debug
        )
        spotter_locator=spotter_locator["locator"]
        spotter_country, spotter_continent = resolve_country_and_continent(
            callsign=spotter_callsign, 
            # prefixes_to_locators=prefixes_to_locators
            )
        if not spotter_locator:
            spotter_locator = resolve_locator(
                callsign=spotter_callsign, 
                # prefixes_to_locators=prefixes_to_locators
            )
            
        spotter_lat, spotter_lon = locator_to_coordinates(spotter_locator)

    if geo_cache_dx:
        dx_locator = geo_cache_dx["locator"]
        dx_lat = geo_cache_dx["lat"]
        dx_lon = geo_cache_dx["lon"]
        dx_country = geo_cache_dx["country"]
        dx_continent = geo_cache_dx["continent"]
    else:
        dx_country, dx_continent = resolve_country_and_continent(
            callsign=dx_callsign, 
            # prefixes_to_locators=prefixes_to_locators
        )
        if not dx_locator:
            dx_locator = get_locator_from_qrz(
                qrz_session_key=qrz_session_key, 
                callsign=dx_callsign, 
                debug=debug
            )
            dx_locator = dx_locator["locator"]
            
            if not dx_locator:
                dx_locator = resolve_locator(
                    callsign=dx_callsign, 
                    # prefixes_to_locators=prefixes_to_locators
                    )
            
        dx_lat, dx_lon = locator_to_coordinates(dx_locator)

    if frequency in FT8_HF_FREQUENCIES or re.match("FT8", comment.upper()):
        mode = "FT8"
    
    elif frequency in FT4_HF_FREQUENCIES or re.match("FT4", comment.upper()):
        mode = "FT4"

    holy_spot_record = HolySpot(
        date=date,  
        time=time,  
        date_time=datetime.combine(date, time, tzinfo=timezone.utc),
        mode=mode,  
        band=band,
        frequency=frequency,
        spotter_callsign=spotter_callsign,
        spotter_locator=spotter_locator,
        spotter_lat=spotter_lat,
        spotter_lon=spotter_lon,
        spotter_country=spotter_country,
        spotter_continent=spotter_continent,
        dx_callsign=dx_callsign,
        dx_locator=dx_locator,
        dx_lat=dx_lat,
        dx_lon=dx_lon,
        dx_country=dx_country,
        dx_continent=dx_continent,
        comment=comment

    )
    geo_cache_spotter_record = GeoCache(
        callsign=spotter_callsign,
        locator=spotter_locator,
        lat=spotter_lat,
        lon=spotter_lon,
        country=spotter_country,
        continent=spotter_continent,
        date=date,  
        time=time,  
        date_time=datetime.combine(date, time, tzinfo=timezone.utc),
        )
    geo_cache_dx_record = GeoCache(
        callsign=dx_callsign,
        locator=dx_locator,
        lat=dx_lat,
        lon=dx_lon,
        country=dx_country,
        continent=dx_continent,
        date=date,  
        time=time,
        date_time=datetime.combine(date, time, tzinfo=timezone.utc),
    )
    return holy_spot_record, geo_cache_spotter_record, geo_cache_dx_record
