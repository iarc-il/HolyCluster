from shared.geo import get_geo_details as shared_get_geo_details

from collectors.db.valkey_config import get_valkey_client
from collectors.settings import settings

valkey_client = get_valkey_client()


async def get_geo_details(qrz_session_key: str, callsign: str, http_client):
    return await shared_get_geo_details(
        valkey_client, qrz_session_key, callsign, settings.valkey_geo_expiration, http_client
    )
