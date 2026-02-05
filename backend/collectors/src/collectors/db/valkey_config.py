import redis.asyncio

from collectors.settings import settings

_valkey_client = None


def get_valkey_client():
    global _valkey_client
    if _valkey_client is None:
        _valkey_client = redis.asyncio.Redis(
            host=settings.valkey_effective_host,
            port=settings.valkey_effective_port,
            db=settings.valkey_db,
            decode_responses=True,
        )
    return _valkey_client
