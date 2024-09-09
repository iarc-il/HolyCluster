import sys
from pathlib import Path
from loguru import logger

grandparent_folder = Path(__file__).parents[2] # 2 directories up
sys.path.append(f"{grandparent_folder}")
from src.settings import (
    QRZ_USER,
    QRZ_PASSOWRD,
    QRZ_API_KEY,
)
from src.qrz import get_qrz_session_key

qrz_session_key = get_qrz_session_key(username=QRZ_USER, password=QRZ_PASSOWRD, api_key=QRZ_API_KEY)
logger.debug(f"{qrz_session_key}")
