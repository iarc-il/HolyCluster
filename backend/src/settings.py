from environs import Env

env = Env()
env.read_env()

PSQL_USERNAME = env.str("PSQL_USERNAME")
PSQL_PASSWORD = env.str("PSQL_PASSWORD")

QRZ_USER = env.str("QRZ_USER")
QRZ_PASSOWRD = env.str("QRZ_PASSWORD")
QRZ_API_KEY = env.str("QRZ_API_KEY")

HOST = "localhost"
PORT = "5432"

# Connect to the default 'postgres' database
DATABASE = "holy_cluster"

GENERAL_DB_URL = f"postgresql+psycopg2://{PSQL_USERNAME}:{PSQL_PASSWORD}@{HOST}:{PORT}"
DB_URL = f"{GENERAL_DB_URL}/{DATABASE}"

FT8_HF_FREQUENCIES = [
    "1840.0",  # 160m
    "3573.0",  # 80m
    "5357.0",  # 60m
    "7074.0",  # 40m
    "10136.0", # 30m
    "14074.0", # 20m
    "18100.0", # 17m
    "21074.0", # 15m
    "24915.0", # 12m
    "28074.0"  # 10m
]

FT4_HF_FREQUENCIES = [
    "3575.0",   # 80m
    "70475.0",  # 40m
    "10140.0",  # 30m
    "14080.0",  # 20m
    "18104.0",  # 17m
    "21140.0",  # 15m
    "24919.0",  # 12m
    "28180.0",  # 10m
    "50318.0"   # 6m
]