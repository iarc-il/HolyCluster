import asyncio
from pathlib import Path
import csv
from loguru import logger

CALLSIGN = "4X0IARC"

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
        if debug:
            logger.debug(" ")
    return clusters


from settings import (
    DEBUG,
)
from misc import string_to_boolean, open_log_file



async def connect_to_cluster(cluster: dict, debug: bool = False):
    try:
        name = cluster["Cluster Name"]
        hostname = cluster["Hostname"]
        port = cluster["Port"]
        cluster_type = cluster["Type"]
        if debug:
            logger.debug(f"collect_spots_from_cluster - {cluster}")
            logger.debug(f"Trying to connect to cluster {name=:20} {hostname=:30} {port=:5}     {cluster_type=:20}")

        # Open connection
        reader, writer = await asyncio.open_connection(hostname, port)
        if debug:
            logger.debug(f"Connected to cluster {hostname}:{port}.")

        # Wait for login prompt and send callsign
        while True:
            line = await reader.readline()
            # logger.debug(line)
            decoded_line = line.decode(errors="ignore").strip()
            if debug:
                logger.debug(f"{hostname}:{port}   {decoded_line}")
            #if "login" in decoded_line.lower():
            writer.write((CALLSIGN + "\n").encode())
            await writer.drain()
            if debug:
                logger.debug(f"{hostname}:{port}  Logged in as {CALLSIGN}")
            writer.write(("show/ver"+ "\n").encode())
            line = await reader.readline()
            # logger.debug(line)
            decoded_line = line.decode(errors="ignore").strip()
            if debug:
                logger.debug(f"{hostname}:{port}   {decoded_line}")
            # await writer.drain()
            if cluster_type in ["dx-spider", "cc-cluster"]:
                while " >" not in decoded_line:
                    line = await reader.readline()
                    # logger.debug(line)
                    decoded_line = line.decode(errors="ignore").strip()
                    if debug:
                        logger.debug(f"{hostname}:{port}   {decoded_line}")
            break

    except Exception as e:
            logger.error(f"Error initial connection: {e}   {hostname=} {port=} {cluster_type=}")


    # Read and parse DX spots
    # try:
    #     if cluster_type in ["dx-spider", "cc-cluster"]:
    #         writer.write(("set/width 130"+ "\n").encode())
    #         await writer.drain()
    #
    #     writer.write(("set/dxgrid"+ "\n").encode())
    #     await writer.drain()
    #     writer.write(("set/dxitu"+ "\n").encode())
    #     await writer.drain()
    #     writer.write(("unset/beep"+ "\n").encode())
    #     await writer.drain()
    #     while True:
    #     # logger.debug(line)
    #     decoded = line.decode(errors="ignore").strip()
    #     logger.debug(decoded)
    #     if decoded.startswith("DX de"):
    #         spot = parse_dx_line(decoded)
    #         if spot:
    #         logger.debug(json.dumps(spot, indent=2))
    #         else:
    #         logger.debug("***** Could not parse spot line ***")
    #         logger.error("\n***** Could not parse spot line ***")
    #         logger.error(decoded)
    #
    # except Exception as e:
    #         logger.error(f"Error spots parsing: {e}   {hostname=} {port=} {cluster_type=}")
    #


        


async def main(debug: bool = False):
    tasks = []
    try:
        filepath = f"{Path.cwd()}/src/telnet_servers.csv"
        if debug:
            logger.debug(f"{filepath=}")
        clusters = read_clusters_csv(filepath=filepath, debug=debug)

        for cluster in clusters:
            if not cluster["Cluster Name"][0] == "#":
                task = asyncio.create_task(connect_to_cluster(cluster=cluster, debug=debug))
                tasks.append(task)
        all_clusters = await asyncio.gather(*tasks)

    except Exception as e:
            logger.error(f"Error: {e}")


            

if __name__ == "__main__":
    if string_to_boolean(DEBUG):
        logger.info("DEBUG is True")
        open_log_file("logs/run_telnet_collector")
    else:
        logger.info("DEBUG is False")
    asyncio.run(main(debug=string_to_boolean(DEBUG)))

