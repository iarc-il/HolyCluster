import socket
from collectors.db.valkey_config import get_valkey_client
from collectors.settings import (
    VALKEY_HOST,
    VALKEY_PORT,
    VALKEY_DB,
    VALKEY_GEO_EXPIRATION,
)
from shared.geo import get_geo_details as shared_get_geo_details

global valkey_client
try:
    if not socket.gethostbyname(VALKEY_HOST):
        pass
except socket.gaierror:
    VALKEY_HOST = "127.0.0.1"
valkey_client = get_valkey_client(host=VALKEY_HOST, port=VALKEY_PORT, db=VALKEY_DB)


async def get_geo_details(qrz_session_key: str, callsign: str):
    return await shared_get_geo_details(valkey_client, qrz_session_key, callsign, VALKEY_GEO_EXPIRATION)
