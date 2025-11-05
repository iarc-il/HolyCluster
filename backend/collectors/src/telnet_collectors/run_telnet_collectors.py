import csv
import os
import threading
from loguru import logger
from datetime import datetime

from telnet_collectors import telnet_and_collect
from collectors.src.settings import (
    DEBUG,
    USERNAME_FOR_TELNET_CLUSTERS,
)

def run_concurrent_telnet_connections():
    """
    Reads a list of Telnet servers from a CSV file and launches a separate 
    thread to connect to each server concurrently.
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(script_dir, 'telnet_servers.csv')

    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    global_log_filename = f"{timestamp}-all_clusters.txt"
    log_dir = os.path.join(script_dir, '..', '..', 'logs')
    os.makedirs(log_dir, exist_ok=True)
    telnet_log_dir = os.path.join(log_dir, 'telnet')
    os.makedirs(telnet_log_dir, exist_ok=True)
    global_log_file = os.path.join(telnet_log_dir, global_log_filename)

    logger.remove()
    console_format = "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{extra[cluster_info_padded]}</cyan> | <cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
    logger.add(lambda msg: print(msg, end=''), format=console_format, level="INFO")
    logger.add(global_log_file, format=console_format, level="INFO", enqueue=True, backtrace=True, diagnose=True)

    try:
        with open(csv_path, 'r') as f:
            reader = csv.DictReader(f)
            servers = list(reader)
    except FileNotFoundError:
        logger.error(f"The file {csv_path} was not found.")
        return

    threads = []
    for server in servers:
        host = server.get('hostname')
        port = int(server.get('port'))
        cluster_type = server.get('type', 'unknown')

        if not host or not port:
            logger.warning(f"Skipping server with missing host or port: {server}")
            continue

        cluster_log_dir = os.path.join(telnet_log_dir, host)
        os.makedirs(cluster_log_dir, exist_ok=True)

        thread = threading.Thread(
            target=telnet_and_collect,
            args=(host, port, USERNAME_FOR_TELNET_CLUSTERS, cluster_type, cluster_log_dir, DEBUG),
            daemon=True
        )
        threads.append(thread)
        thread.start()
        log = logger.bind(cluster_info_padded=f"{host}:{port} ({cluster_type})".ljust(45))
        log.info(f"Starting connection to {host}:{port} , debug={DEBUG}")

    for thread in threads:
        thread.join()

if __name__ == '__main__':
    run_concurrent_telnet_connections()
