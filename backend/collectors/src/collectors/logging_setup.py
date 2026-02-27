from datetime import datetime

from loguru import logger


def open_log_file(log_filename_prefix: str):
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_filename = f"{log_filename_prefix}.{timestamp}.log"
    logger.add(log_filename, rotation="10 MB", compression="zip")
    logger.info(f"log file: {log_filename}")
    return log_filename


def open_task_log_file(log_filename_prefix: str):
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_file_path = f"{log_filename_prefix}.{timestamp}.log"
    logger.add(
        log_file_path,
        filter=lambda record, tid=log_filename_prefix: record["extra"].get("task") == tid,
        format="{time:YYYY-MM-DD HH:mm:ss.SSS} - {thread.name} - {level} - {message}",
    )
    return logger.bind(task=log_filename_prefix)
