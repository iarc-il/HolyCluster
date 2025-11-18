from environs import Env
from pathlib import Path

env = Env()
print(Path.cwd().name)
print(Path(__file__))
dotenv_path = Path(__file__).parents[2] / ".env"
print(dotenv_path)
env.read_env(path=dotenv_path, recurse=False)

DEBUG = env.bool("DEBUG", default=False)
POSTGRES_USER = env.str("POSTGRES_USER")
POSTGRES_PASSWORD = env.str("POSTGRES_PASSWORD")
POSTGRES_HOST = env.str("POSTGRES_HOST")
POSTGRES_PORT = env.str("POSTGRES_PORT")
POSTGRES_DB_NAME = env.str("POSTGRES_DB_NAME")

POSTGRES_GENERAL_DB_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}"
POSTGRES_DB_URL = f"{POSTGRES_GENERAL_DB_URL}/{POSTGRES_DB_NAME}"
POSTGRES_DB_RETENTION_DAYS = 14

VALKEY_HOST = env.str("VALKEY_HOST")
VALKEY_PORT = env.str("VALKEY_PORT")
VALKEY_DB = env.str("VALKEY_DB")
VALKEY_SPOT_EXPIRATION = env.int("VALKEY_SPOT_EXPIRATION", default=60)
VALKEY_GEO_EXPIRATION = env.int("VALKEY_GEO_EXPIRATION", default=3600) 

USERNAME_FOR_TELNET_CLUSTERS = env.str("USERNAME_FOR_TELNET_CLUSTERS")

QRZ_USER = env.str("QRZ_USER")
QRZ_PASSOWRD = env.str("QRZ_PASSWORD")
QRZ_API_KEY = env.str("QRZ_API_KEY")
QRZ_SESSION_KEY_REFRESH = env.int("QRZ_SESSION_KEY_REFRESH")

