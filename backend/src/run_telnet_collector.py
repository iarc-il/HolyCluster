from dataclasses import dataclass
import re
import json
import asyncio
from pathlib import Path
import csv
from loguru import logger

from settings import (
    DEBUG,
)
from misc import string_to_boolean, open_log_file

CALLSIGN = "4X0IARC"

@dataclass
class TelnetCluster:
    name: str
    hostname: str
    port: int
    type: str


def read_clusters_csv(filepath: str, debug: bool = False) -> list[TelnetCluster]:
    clusters = []
    try:
        with open(filepath, newline='') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if debug:
                    logger.debug(row)
                if not row["name"][0] == "#":
                    clusters.append(TelnetCluster(
                        name=row["name"],
                        hostname=row["hostname"],
                        port=int(row["port"]),
                        type=row["type"]
                    ))
            if debug:
                logger.debug(" ")
    except Exception as e:
            logger.error(f"Error read_cluster_csv: {e}")
    
    return clusters


async def connect_to_cluster(cluster: dict, debug: bool = False):
    reader = None
    writer = None
    try:
        if debug:
            logger.debug(f"collect_spots_from_cluster - {cluster.name}")
            logger.debug(f"Trying to connect to cluster {cluster.name=:20} {cluster.hostname=:30} {cluster.port=:5}     {cluster.type=:20}")

        # Open connection
        reader, writer = await asyncio.open_connection(cluster.hostname, cluster.port)
        if debug:
            logger.debug(f"Connected to cluster {cluster.hostname}:{cluster.port} {cluster.type}")
        await asyncio.sleep(1)  # small delay to let banner print

    except Exception as e:
            logger.error(f"Error initial connection: {e}   {cluster.hostname=} {cluster.port=} {cluster.type=}")

    finally:
        return reader, writer


async def login_to_cluster(cluster: TelnetCluster, reader, writer, debug: bool = False):
# Wait for login prompt and send CALLSIGN
#
    try:
        while True:
            line = await reader.readline()
            # logger.debug(line)
            decoded_line = line.decode(errors="ignore").strip()
            if debug:
                logger.debug(f"{cluster.hostname}:{cluster.port} {cluster.type}  {decoded_line}")
            #if "login" in decoded_line.lower():
            writer.write((CALLSIGN + "\n").encode())
            await writer.drain()
            if debug:
                logger.debug(f"{cluster.hostname}:{cluster.port} {cluster.type} Logged in as {CALLSIGN}")
            if cluster.type == "ar-cluster":
                await asyncio.sleep(5)
                writer.write((CALLSIGN + "\n").encode())
                await asyncio.sleep(1)
                writer.write(("y\n").encode())
                await asyncio.sleep(1)
                writer.write(("\n").encode())

            writer.write(("show/ver"+ "\n").encode())
            line = await reader.readline()
            # logger.debug(line)
            decoded_line = line.decode(errors="ignore").strip()
            if debug:
                logger.debug(f"{cluster.hostname}:{cluster.port} {cluster.type}  {decoded_line}")
            # await writer.drain()
            if cluster.type in ["dx-spider", "cc-cluster"]:
                while " >" not in decoded_line:
                    line = await reader.readline()
                    # logger.debug(line)
                    decoded_line = line.decode(errors="ignore").strip()
                    if debug:
                        logger.debug(f"{cluster.hostname}:{cluster.port} {cluster.type}  {decoded_line}")
            break

    except Exception as e:
            logger.error(f"Error during login: {e}   {cluster.hostname=} {cluster.port=} {cluster.type=}")


async def parse_dx_line(cluster: TelnetCluster, line: str, debug: bool = False):
    try:
        if debug:
            logger.debug("parse_dx_line")
        # cc-cluster & dx-cluster
        DX_RE = re.compile(
        r"^DX de (\S+):\s+(\d+\.\d)\s+(\S+)\s+(.*?)\s+?(\w+) (\d+Z)\s+(\w+)"
        )
        match = DX_RE.match(line.strip())
        if match:
            spot = {
                "spotter_callsign": match.group(1),
                "frequency": float(match.group(2)),
                "dx_callsign": match.group(3),
                "comment": match.group(4).strip(),
                "dx_locator": match.group(5),
                "time": match.group(6),
                "spotter_locator": match.group(7),
            }
            return spot

        # ar-cluster       
        # DX de K5TR-#:    14056.0  VE2PID/W8    CW 17 dB 22 WPM CQ             2010Z
        # DX de KB8OTK:    18100.9  OD5ZZ                                       2053Z
        DX_RE = re.compile(
        r"^DX de (\S+):\s+(\d+\.\d)\s+(\S+)\s+(.*?)\s+? (\d+Z)"
        )
        match = DX_RE.match(line.strip())
        if match:
            spot = {
                "spotter_callsign": match.group(1),
                "frequency": float(match.group(2)),
                "dx_callsign": match.group(3),
                "comment": match.group(4).strip(),
                "time": match.group(5),
            }
            return spot

    except Exception as e:
            logger.error(f"Error parse_dx_line: {e}   {cluster.hostname=} {cluster.port=} {cluster.type=}")

    return None


async def listen_to_cluster(cluster: TelnetCluster, reader, writer, debug: bool = False):
    # Read and parse DX spots
    try:
        if cluster.type in ["dx-spider", "cc-cluster"]:
            writer.write(("set/width 130"+ "\n").encode())
            await writer.drain()
            writer.write(("set/dxgrid"+ "\n").encode())
            await writer.drain()
            writer.write(("set/dxitu"+ "\n").encode())
            await writer.drain()
            writer.write(("unset/beep"+ "\n").encode())
            await writer.drain()

        while True:
            line = await reader.readline()
            decoded_line = line.decode(errors="ignore").strip()
            if debug and line:
                # logger.debug(f"{cluster.hostname}:{cluster.port}   {line=}")
                logger.debug(f"{cluster.hostname}:{cluster.port} {cluster.type}  {decoded_line}")
            if decoded_line.startswith("DX de"):
                spot = await parse_dx_line(cluster=cluster, line=decoded_line, debug=debug)
                if spot:
                    logger.debug(json.dumps(spot, indent=2))
                else:
                    logger.error(f"{cluster.hostname}:{cluster.port}  {cluster.type} ***** Could not parse spot line *****")
                    logger.error(decoded_line)

    except Exception as e:
            logger.error(f"Error spots parsing: {e}   {cluster.hostname=} {cluster.port=} {cluster.type=}")

    # finally:
        # await asyncio.sleep(10)

        


async def connect_and_listen(cluster: dict, debug: bool = False):
    try:
        reader, writer = await connect_to_cluster(cluster=cluster, debug=debug)
        if reader:
            await login_to_cluster(cluster=cluster, reader=reader, writer=writer, debug=debug)
            await listen_to_cluster(cluster=cluster, reader=reader, writer=writer, debug=debug)

    except Exception as e:
            logger.error(f"Error connect_and_listen: {e}   {cluster.hostname=} {cluster.port=} {cluster.type=}")




async def main(debug: bool = False):
    tasks = []
    try:
        filepath = f"{Path.cwd()}/src/telnet_servers.csv"
        if debug:
            logger.debug(f"{filepath=}")

        # Read clusters from CSV file
        clusters = read_clusters_csv(filepath=filepath, debug=debug)
        # Create async tasks array
        tasks = [asyncio.create_task(connect_and_listen(cluster=cluster, debug=debug)) for cluster in clusters]
        # Run async tasks
        await asyncio.gather(*tasks)

    except Exception as e:
            logger.error(f"Error: {e}")


            

if __name__ == "__main__":
    if string_to_boolean(DEBUG):
        logger.info("DEBUG is True")
        open_log_file("logs/run_telnet_collector")
    else:
        logger.info("DEBUG is False")
    asyncio.run(main(debug=string_to_boolean(DEBUG)))

