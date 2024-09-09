import configparser
import httpx
import xml.etree.ElementTree as ET



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
        

class QRZ:
    def __init__(self, config_file_path):
        # Create a configparser object
        config = configparser.ConfigParser()
        # Read the config file
        config.read(config_file_path)
        
        # Get the credentials
        self.username = config.get('credentials', 'username')
        self.password = config.get('credentials', 'password')
        self.api_key = config.get('credentials', 'api_key')

        self.session_key = self.get_session_key(self.username, self.password, self.api_key)

    def get_session_key(self, username, password, api_key):
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

    def get_callsign_info(self, callsign):
        if self.session_key:
            url = f"https://xmldata.qrz.com/xml/current/?s={self.session_key};callsign={callsign}"
            with httpx.Client() as client:
                response = client.get(url)
            
            if response.status_code == 200:
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

    def get_callsign_grid(self, callsign):
        return self.get_callsign_info(callsign)["grid"]

