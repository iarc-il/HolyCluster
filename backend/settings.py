from environs import Env
from pathlib import Path

env = Env()
dotenv_path = Path(__file__).parent / ".env"
env.read_env(path=dotenv_path, recurse=False)

DEBUG = env.str("DEBUG")
POSTGRES_USER = env.str("POSTGRES_USER")
POSTGRES_PASSWORD = env.str("POSTGRES_PASSWORD")
POSTGRES_HOST = env.str("POSTGRES_HOST")
POSTGRES_PORT = env.str("POSTGRES_PORT")
POSTGRES_DB_NAME = env.str("POSTGRES_DB_NAME")

POSTGRES_GENERAL_DB_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}"
POSTGRES_DB_URL = f"{POSTGRES_GENERAL_DB_URL}/{POSTGRES_DB_NAME}"

QRZ_USER = env.str("QRZ_USER")
QRZ_PASSOWRD = env.str("QRZ_PASSWORD")
QRZ_API_KEY = env.str("QRZ_API_KEY")



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
    (144174.0, 144177.0), # 2m VHF
    (432174.0, 432177.0), # 70cm - UHF
    (1296174.0, 1296177.0), #23cm - SHF
    (222080.0, 222083), # 1.25m
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
    (50318.0, 50321.0),  # 6m
    (144170.0, 144173.0), # 2m - VHF
]
