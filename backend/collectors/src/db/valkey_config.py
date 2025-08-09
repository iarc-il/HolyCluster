# src/valkey_config.py
import os
import redis

VALKEY_HOST = os.getenv("VALKEY_HOST", "localhost")
VALKEY_PORT = int(os.getenv("VALKEY_PORT", 6379))
VALKEY_DB = int(os.getenv("VALKEY_DB", 0))

_valkey_client = None

def get_valkey_client():
    global _valkey_client
    if _valkey_client is None:
        _valkey_client = redis.Redis(
            host=VALKEY_HOST,
            port=VALKEY_PORT,
            db=VALKEY_DB,
            decode_responses=True # Decodes responses to UTF-8 strings
        )
    return _valkey_client