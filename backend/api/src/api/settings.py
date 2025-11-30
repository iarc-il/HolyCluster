from environs import Env

env = Env()
env.read_env(".env")

RUNTIME_ENV = env.str("RUNTIME_ENV", default="local")

POSTGRES_USER = env.str("POSTGRES_USER")
POSTGRES_PASSWORD = env.str("POSTGRES_PASSWORD")
SPOTS_LOG_PATH = env.str("SPOTS_LOG_PATH")

if RUNTIME_ENV == "docker":
    POSTGRES_HOST = env.str("POSTGRES_HOST")
    POSTGRES_PORT = env.str("POSTGRES_PORT")
else:
    POSTGRES_HOST = env.str("POSTGRES_HOST_LOCAL")
    POSTGRES_PORT = env.str("POSTGRES_PORT_LOCAL")

DATABASE = env.str("POSTGRES_DB_NAME", default="holy_cluster")
GENERAL_DB_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}"
DB_URL = f"{GENERAL_DB_URL}/{DATABASE}"

# TODO: The defaults are copied from ../config/paths.env,
# We should find a way to use it as a fallback
UI_DIST_PATH = env.path("UI_DIST_PATH", default="/opt/ui-dist")
CATSERVER_MSI_DIR = env.path("CATSERVER_MSI_PATH", default="/opt/msi")
