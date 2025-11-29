# src/valkey_config.py
import os
import redis

_valkey_client = None

def get_valkey_client(host, port, db, decode_responses: bool=True):
    global _valkey_client
    if _valkey_client is None:
        _valkey_client = redis.Redis(
            host=host,
            port=port,
            db=db,
            decode_responses=decode_responses # Decodes responses to UTF-8 strings
        )
    return _valkey_client
