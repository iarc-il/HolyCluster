from datetime import datetime
import logging
import threading
import os
from loguru import logger

def string_to_boolean(value: str) -> bool:
    if value.strip().lower() == "true":
        return True
    elif value.strip().lower() == "false":
        return False


def open_log_file(log_filename_prefix: str, debug: bool = False):
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_filename = f"{log_filename_prefix}.{timestamp}.log"
    # logger.remove()
    logger.info(f"Opening log file at: {log_filename}")
    try:
        logger.add(log_filename, rotation="10 MB", compression="zip")
        logger.info(f"log file: {log_filename}")
        return log_filename 

    except Exception as ex:
        template = "**** ERROR OPENING LOG FILE **** An exception of type {0} occured. Arguments: {1!r}"
        message = template.format(type(ex).__name__, ex.args)
        print(message)

def open_log_file2(log_filename_prefix: str, debug: bool = False):
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_file_path = f"{log_filename_prefix}.{timestamp}.log"
    try:
        thread_id = threading.get_ident()
        thread_logger = logging.getLogger(log_filename_prefix)

        if not thread_logger.hasHandlers():
            handler = logging.FileHandler(log_file_path)
            formatter = logging.Formatter('%(asctime)s - %(threadName)s - %(levelname)s - %(message)s')
            handler.setFormatter(formatter)
            thread_logger.addHandler(handler)
            thread_logger.setLevel(logging.DEBUG)
            # thread_logger.info(f"log file: {log_file_path}")

        return thread_logger

    except Exception as ex:
        template = "**** ERROR OPENING LOG FILE **** An exception of type {0} occured. Arguments: {1!r}"
        message = template.format(type(ex).__name__, ex.args)
        print(message)

