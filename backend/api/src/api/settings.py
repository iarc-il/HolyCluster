from pathlib import Path

from environs import Env

env = Env()
env.read_env(".env")

IN_DOCKER = Path("/.dockerenv").exists()

POSTGRES_USER = env.str("POSTGRES_USER")
POSTGRES_PASSWORD = env.str("POSTGRES_PASSWORD")
SPOTS_LOG_PATH = env.str("SPOTS_LOG_PATH")

if IN_DOCKER:
    POSTGRES_HOST = env.str("POSTGRES_HOST")
    POSTGRES_PORT = env.str("POSTGRES_PORT")
    VALKEY_HOST = env.str("VALKEY_HOST")
    VALKEY_PORT = env.int("VALKEY_PORT")
else:
    POSTGRES_HOST = env.str("POSTGRES_HOST_LOCAL")
    POSTGRES_PORT = env.str("POSTGRES_PORT_LOCAL")
    VALKEY_HOST = env.str("VALKEY_HOST_LOCAL")
    VALKEY_PORT = env.int("VALKEY_PORT_LOCAL")


DATABASE = env.str("POSTGRES_DB_NAME", default="holy_cluster")
GENERAL_DB_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}"
DB_URL = f"{GENERAL_DB_URL}/{DATABASE}"

UI_DIST_PATH = env.path("UI_DIST_PATH")
CATSERVER_MSI_DIR = env.path("CATSERVER_MSI_DIR")

QRZ_USER = env.str("QRZ_USER")
QRZ_PASSWORD = env.str("QRZ_PASSWORD")
QRZ_API_KEY = env.str("QRZ_API_KEY")
QRZ_SESSION_KEY_REFRESH = env.int("QRZ_SESSION_KEY_REFRESH")
VALKEY_DB = env.str("VALKEY_DB")
VALKEY_GEO_EXPIRATION = env.int("VALKEY_GEO_EXPIRATION", default=3600)
