import socket

from shared.geo import get_geo_details as shared_get_geo_details

from collectors.db.valkey_config import get_valkey_client
from collectors.settings import settings

global valkey_client
valkey_host = settings.valkey_effective_host
try:
    if not socket.gethostbyname(valkey_host):
        pass
except socket.gaierror:
    valkey_host = "127.0.0.1"
valkey_client = get_valkey_client(host=valkey_host, port=settings.valkey_effective_port, db=settings.valkey_db)


async def get_geo_details(qrz_session_key: str, callsign: str):
    return await shared_get_geo_details(valkey_client, qrz_session_key, callsign, settings.valkey_geo_expiration)
