import asyncio
import csv
import os
import sys

from loguru import logger

from ..logging_setup import open_log_file
from ..settings import settings
from .client import telnet_and_collect


def get_telnet_clusters_list(csv_path: str, debug: bool = False):
    servers = None
    try:
        with open(csv_path, "r") as f:
            filtered_lines = (line for line in f if not line.lstrip().startswith("#"))
            reader = csv.DictReader(filtered_lines)
            servers = list(reader)
            logger.debug(f"{servers=}")
    except FileNotFoundError:
        logger.error(f"The file {csv_path} was not found.")

    return servers


def run_concurrent_telnet_connections(output_queue: asyncio.Queue):
    """
    Reads a list of Telnet servers from a CSV file and launches a separate
    async task to connect to each server concurrently.
    All tasks push spots to the shared output_queue.
    """
    if settings.username_for_telnet_clusters == "":
        logger.error("USERNAME_FOR_TELNET_CLUSTERS must not be empty")
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(script_dir, "telnet_servers.csv")
    logger.debug(f"{script_dir=}")
    logger.debug(f"{csv_path=}")

    global_log_filename = "all_clusters"
    log_dir = os.path.join(script_dir, "..", "..", "logs")
    logger.debug(f"{global_log_filename=}")
    logger.debug(f"{log_dir=}")
    os.makedirs(log_dir, exist_ok=True)
    telnet_log_dir = os.path.join(log_dir, "telnet_collectors")
    os.makedirs(telnet_log_dir, exist_ok=True)
    global_log_file = os.path.join(telnet_log_dir, global_log_filename)
    logger.debug(f"{telnet_log_dir=}")
    logger.debug(f"{global_log_file=}")

    open_log_file(log_filename_prefix=global_log_file, debug=False)

    servers = get_telnet_clusters_list(csv_path, debug=False)
    tasks = []
    for server in servers:
        host = server.get("hostname")
        port = int(server.get("port"))
        logger.info(f"Creating task for server {host}:{port}")
        if not host or not port:
            logger.error(f"Skipping server with missing host or port: {server}")
            continue

        cluster_log_dir = os.path.join(telnet_log_dir, host)
        logger.debug(f"{cluster_log_dir=}")
        os.makedirs(cluster_log_dir, exist_ok=True)

        task = asyncio.create_task(
            telnet_and_collect(
                host,
                port,
                settings.username_for_telnet_clusters,
                cluster_log_dir,
                output_queue,
            ),
            name=host,
        )
        tasks.append(task)
        logger.info(f"Starting connection to {host}:{port}")

    return tasks
