import argparse
import os
import time
import re
import json
from loguru import logger

from collectors.src.misc import open_log_file
from collectors.src.db.valkey_config import get_valkey_client

from collectors.src.settings import (
    DEBUG,
    VALKEY_HOST,
    VALKEY_PORT,
    VALKEY_DB,
    VALKEY_SPOT_EXPIRATION,
)



