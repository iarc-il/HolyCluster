from environs import Env

env = Env()
env.read_env()

PSQL_USERNAME = env.str("PSQL_USERNAME")
PSQL_PASSWORD = env.str("PSQL_PASSWORD")

HOST = "localhost"
PORT = "5432"

# Connect to the default 'postgres' database
DATABASE = "postgres"

DB_URL = f"postgresql+psycopg2://{PSQL_USERNAME}:{PSQL_PASSWORD}@{HOST}:{PORT}/{DATABASE}"
