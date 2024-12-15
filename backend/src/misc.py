from datetime import datetime
from loguru import logger

def string_to_boolean(value: str) -> bool:
    if value.strip().lower() == "true":
        return True
    elif value.strip().lower() == "false":
        return False



def open_log_file(log_filename_prefix):
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    try:
        log_filename_info = f"{log_filename_prefix}.INFO.{timestamp}.txt"
        log_filename_error = f"{log_filename_prefix}.ERROR.{timestamp}.txt"
        log_filename_debug = f"{log_filename_prefix}.DEBUG.{timestamp}.txt"

        # logger.add(log_filename, rotation="10 MB")
        logger.add(log_filename_info, rotation="10 MB", filter=lambda record: record["level"].name == "INFO")
        logger.add(log_filename_error, rotation="10 MB", filter=lambda record: record["level"].name == "ERROR")
        logger.add(log_filename_debug, rotation="10 MB", filter=lambda record: record["level"].name == "DEBUG")

    except Exception as ex:
        template = "**** ERROR OPENING LOG FILE **** An exception of type {0} occured. Arguments: {1!r}"
        message = template.format(type(ex).__name__, ex.args)
        print(message)
