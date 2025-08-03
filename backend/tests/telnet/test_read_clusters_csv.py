from pathlib import Path
import csv
from loguru import logger


def read_clusters_csv(filepath:str, debug: bool = False):
    clusters = []
    with open(filepath, mode='r', newline='') as file:
        reader = csv.DictReader(file)
        for row in reader:
            # Convert port from string to int
            row["Port"] = int(row["Port"])
            if debug:
                logger.debug(row)
            clusters.append(row)
    return clusters

debug = True
filepath = f"{Path.cwd()}/src/telnet_servers.csv"
logger.debug(f"{filepath=}")
cluster = read_clusters_csv(filepath=filepath, debug=debug)
