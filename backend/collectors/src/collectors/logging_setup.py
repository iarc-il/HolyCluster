from pathlib import Path

from loguru import logger
from shared.logging import LogFilePolicy, add_bounded_file_sink


GLOBAL_LOG_POLICY = LogFilePolicy(retention=10)
TASK_LOG_POLICY = LogFilePolicy(retention=3)


def _stable_log_path(log_filename_prefix: str) -> Path:
    path = Path(log_filename_prefix)
    return path if path.suffix == ".log" else path.with_name(f"{path.name}.log")


def open_log_file(log_filename_prefix: str):
    log_path = _stable_log_path(log_filename_prefix)
    add_bounded_file_sink(log_path, policy=GLOBAL_LOG_POLICY)
    logger.info(f"log file: {log_path}")
    return str(log_path)


def open_task_log_file(log_filename_prefix: str):
    log_path = _stable_log_path(log_filename_prefix)
    add_bounded_file_sink(
        log_path,
        level="INFO",
        filter=lambda record, tid=log_filename_prefix: record["extra"].get("task") == tid,
        format="{time:YYYY-MM-DD HH:mm:ss.SSS} - {thread.name} - {level} - {message}",
        policy=TASK_LOG_POLICY,
    )
    return logger.bind(task=log_filename_prefix)
