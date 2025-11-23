import csv
import os
import threading
from loguru import logger
from datetime import datetime

from misc import open_log_file
from telnet_collectors import telnet_and_collect
from settings import (
    DEBUG,
    USERNAME_FOR_TELNET_CLUSTERS,
)
def get_telnet_clusters_list(csv_path:str , debug: bool = False):
    servers = None
    try:
        with open(csv_path, 'r') as f:
            reader = csv.DictReader(f)
            servers = list(reader)
            if debug:
                logger.debug(f"{servers=}")
    except FileNotFoundError:
        logger.error(f"The file {csv_path} was not found.")

    return servers


def run_concurrent_telnet_connections(debug: bool=False):
    """
    Reads a list of Telnet servers from a CSV file and launches a separate 
    thread to connect to each server concurrently.
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(script_dir, 'telnet_servers.csv')
    if debug:
        logger.debug(f"{script_dir=}")
        logger.debug(f"{csv_path=}")

    global_log_filename = f"all_clusters"
    log_dir = os.path.join(script_dir, '..', '..', 'logs')
    if debug:
        logger.debug(f"{global_log_filename=}")
        logger.debug(f"{log_dir=}")
    os.makedirs(log_dir, exist_ok=True)
    telnet_log_dir = os.path.join(log_dir, 'telnet_collectors')
    os.makedirs(telnet_log_dir, exist_ok=True)
    global_log_file = os.path.join(telnet_log_dir, global_log_filename)
    if debug:
        logger.debug(f"{telnet_log_dir=}")
        logger.debug(f"{global_log_file=}")

    open_log_file(log_filename_prefix=global_log_file, debug=debug)
    logger.info(f"Start of global_log_file. {debug=}")

    servers = get_telnet_clusters_list(csv_path=csv_path, debug=debug)
    threads = []
    for server in servers:
        host = server.get('hostname')
        port = int(server.get('port'))
        cluster_type = server.get('type', 'unknown')
        logger.info(f"Creating thread for server {host}:{port}  type:{cluster_type}")
        if not host or not port:
            logger.error(f"Skipping server with missing host or port: {server}")
            continue

        cluster_log_dir = os.path.join(telnet_log_dir, host)
        if debug:
            logger.debug(f"{cluster_log_dir=}")
        os.makedirs(cluster_log_dir, exist_ok=True)

        thread = threading.Thread(
            target=telnet_and_collect,
            name=host,
            args=(host, port, USERNAME_FOR_TELNET_CLUSTERS, cluster_type, cluster_log_dir, DEBUG),
            daemon=True
        )
        threads.append(thread)
        thread.start()
        logger.info(f"Starting connection to {host}:{port} , debug={DEBUG}")

    for thread in threads:
        thread.join()

if __name__ == '__main__':
    print(f"{DEBUG=}")
    run_concurrent_telnet_connections(debug=DEBUG)
