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
    "1.840",  # 160m
    "3.573",  # 80m
    "5.357",  # 60m
    "7.074",  # 40m
    "10.136", # 30m
    "14.074", # 20m
    "18.100", # 17m
    "21.074", # 15m
    "24.915", # 12m
    "28.074"  # 10m
]

FT4_HF_FREQUENCIES = [
    "3.575",   # 80m
    "7.0475",  # 40m
    "10.140",  # 30m
    "14.080",  # 20m
    "18.104",  # 17m
    "21.140",  # 15m
    "24.919",  # 12m
    "28.180",  # 10m
    "50.318"   # 6m
]