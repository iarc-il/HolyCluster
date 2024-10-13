import asyncio
import json
from datetime import datetime
from loguru import logger
import httpx

from db_classes import DxheatRaw, HolySpot, CallsignToLocator
from location import resolve_locator, resolve_country, locator_to_coordinates
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
        response = await client.get(url)
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
    record = DxheatRaw(
        number=spot['Nr'],
        spotter=spot['Spotter'],
        frequency=spot['Frequency'],
        dx_call=spot['DXCall'],
        time=datetime.strptime(spot['Time'], '%H:%M').time(),
        date=datetime.strptime(spot['Date'], '%d/%m/%y').date(),
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
    qrz_session_key: str,
    prefixes_to_locators: list,
    callsign_to_locator_cache: CallsignToLocator,
    delay: float = 0,
    debug: bool = False
):
    
    spotter_locator = await get_locator_from_qrz(
        qrz_session_key=qrz_session_key, 
        callsign=spotter_callsign,
        delay=delay, 
        debug=debug
    )
    spotter_locator=spotter_locator["locator"]
    spotter_country = resolve_country(callsign=spotter_callsign, prefixes_to_locators=prefixes_to_locators)
    if not spotter_locator:
        spotter_locator = resolve_locator(callsign=spotter_callsign, prefixes_to_locators=prefixes_to_locators)
        
    spotter_lat, spotter_lon = locator_to_coordinates(spotter_locator)
    dx_country = resolve_country(callsign=dx_callsign, prefixes_to_locators=prefixes_to_locators)
    if not dx_locator:
        dx_locator = get_locator_from_qrz(
            qrz_session_key=qrz_session_key, 
            callsign=dx_callsign, 
            debug=debug
        )
        dx_locator = dx_locator["locator"]
        
        if not dx_locator:
            dx_locator = resolve_locator(callsign=dx_callsign, prefixes_to_locators=prefixes_to_locators)
        
    dx_lat, dx_lon = locator_to_coordinates(dx_locator)
    if frequency in FT8_HF_FREQUENCIES:
        mode = "FT8"
    elif frequency in FT4_HF_FREQUENCIES:
        mode = "FT4"

    record = HolySpot(
        date=date,  
        time=time,  
        mode=mode,  
        band=band,
        frequency=frequency,
        spotter_callsign=spotter_callsign,
        spotter_locator=spotter_locator,
        spotter_lat=spotter_lat,
        spotter_lon=spotter_lon,
        spotter_country=spotter_country,
        dx_callsign=dx_callsign,
        dx_locator=dx_locator,
        dx_lat=dx_lat,
        dx_lon=dx_lon,
        dx_country=dx_country
    )
    return record
