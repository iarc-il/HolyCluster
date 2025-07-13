from environs import Env

env = Env()
env.read_env()

DEBUG = env.str("DEBUG")
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
    (1840.0, 1843.0),   # 160m
    (3573.0, 3575.0),   # 80m
    (5357.0, 5360.5),   # 60m
    (7074.0, 7077.0),   # 40m
    (10136.0, 10139.0), # 30m
    (14074.0, 14077.0), # 20m
    (18100.0, 18104.0), # 17m
    (21074.0, 21077.0), # 15m
    (24915.0, 24918.0), # 12m
    (28074.0, 28077.0), # 10m
    (50313.0, 50316.0), # 6m
    (50323.0, 50326.0), # 6m alternative
]

FT4_HF_FREQUENCIES = [
    (3575.0, 3578.0),   # 80m
    (70475.0, 70478.0),  # 40m
    (10140.0, 10143.0),  # 30m
    (14080.0, 14083.0),  # 20m
    (18104.0, 18107.0),  # 17m
    (21140.0, 21143.0),  # 15m
    (24919.0, 24922.0),  # 12m
    (28180.0, 28183.0),  # 10m
    (50318.0, 50321.0)  # 6m
]