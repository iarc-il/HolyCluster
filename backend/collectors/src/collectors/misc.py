import logging
from datetime import datetime

from loguru import logger


def open_log_file(log_filename_prefix: str, debug: bool = False):
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_filename = f"{log_filename_prefix}.{timestamp}.log"
    logger.info(f"Opening log file at: {log_filename}")
    logger.add(log_filename, rotation="10 MB", compression="zip")
    logger.info(f"log file: {log_filename}")
    return log_filename


def open_log_file2(log_filename_prefix: str, debug: bool = False):
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_file_path = f"{log_filename_prefix}.{timestamp}.log"

    thread_logger = logging.getLogger(log_filename_prefix)

    if not thread_logger.hasHandlers():
        handler = logging.FileHandler(log_file_path)
        formatter = logging.Formatter("%(asctime)s - %(threadName)s - %(levelname)s - %(message)s")
        handler.setFormatter(formatter)
        thread_logger.addHandler(handler)
        thread_logger.setLevel(logging.DEBUG)

    return thread_logger
