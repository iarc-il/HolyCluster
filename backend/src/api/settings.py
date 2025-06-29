from environs import Env

env = Env()
env.read_env()

HOST = "localhost"
PORT = "5432"

PSQL_USERNAME = env.str("PSQL_USERNAME")
PSQL_PASSWORD = env.str("PSQL_PASSWORD")

DATABASE = "holy_cluster"
GENERAL_DB_URL = f"postgresql+psycopg2://{PSQL_USERNAME}:{PSQL_PASSWORD}@{HOST}:{PORT}"
DB_URL = f"{GENERAL_DB_URL}/{DATABASE}"

SSL_KEYFILE = env.str("SSL_KEYFILE", None)
SSL_CERTFILE = env.str("SSL_CERTFILE", None)
SSL_AVAILABLE = SSL_KEYFILE is not None and SSL_CERTFILE is not None

UI_DIR = env.path("UI_DIR")
CATSERVER_MSI_DIR = env.path("CATSERVER_MSI_DIR")
