from datetime import datetime
from loguru import logger

def string_to_boolean(value: str) -> bool:
    if value.strip().lower() == "true":
        return True
    elif value.strip().lower() == "false":
        return False



def open_log_file(log_filename_prefix: str, debug: bool = False):
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_filename = f"{log_filename_prefix}.{timestamp}.log"
    logger.info(f"Opening log file at: {log_filename}")
    try:
        logger.add(log_filename, rotation="10 MB")
        logger.info(f"log file: {log_filename}")
        return log_filename 

    except Exception as ex:
        template = "**** ERROR OPENING LOG FILE **** An exception of type {0} occured. Arguments: {1!r}"
        message = template.format(type(ex).__name__, ex.args)
        print(message)
