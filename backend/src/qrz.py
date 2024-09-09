import configparser
import httpx
import xml.etree.ElementTree as ET
from loguru import logger



def get_qrz_session_key(username, password, api_key):
    url = f"https://xmldata.qrz.com/xml/current/?username={username};password={password};agent=python:{api_key}"
    with httpx.Client() as client:
        response = client.get(url)
    
    if response.status_code == 200:
        root = ET.fromstring(response.text)
        ns = {'qrz': 'http://xmldata.qrz.com'}
        session_key = root.find('.//qrz:Key', ns).text
        return session_key
    else:
        print("Error:", response.status_code)
        return None


def get_qrz_callsign_info(qrz_session_key:str, callsign: str, debug:bool=False):
        if qrz_session_key:
            url = f"https://xmldata.qrz.com/xml/current/?s={qrz_session_key};callsign={callsign}"
            with httpx.Client() as client:
                response = client.get(url)
            if debug:
                logger.debug(f"{response=}")
            
            if response.status_code == 200:
                if debug:
                    logger.debug(f"{response.text=}")
                try:
                    ns = {'qrz': 'http://xmldata.qrz.com'}
                    root = ET.fromstring(response.text)
                    call = root.find('.//qrz:call', ns).text
                    lat = root.find('.//qrz:lat', ns).text
                    lon = root.find('.//qrz:lon', ns).text
                    grid = root.find('.//qrz:grid', ns).text                
                    return { "call":call, "lat":lat, "lon":lon, "grid":grid }
                except:
                    return { "call":callsign, "lat":"", "lon":"", "grid":"" }

            else:
                print("Error:", response.status_code)
                return { "call":callsign, "lat":"", "lon":"", "grid":"" }
        else:
            return { "call":callsign, "lat":"", "lon":"", "grid":"" }

# def get_callsign_grid(self, callsign):
#     return self.get_callsign_info(callsign)["grid"]