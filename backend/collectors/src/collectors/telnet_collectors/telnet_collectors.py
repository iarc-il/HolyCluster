import asyncio
import os
import re
import json
from loguru import logger

from collectors.misc import open_log_file2
from collectors.db.valkey_config import get_valkey_client

from collectors.settings import (
    VALKEY_HOST,
    VALKEY_PORT,
    VALKEY_DB,
    VALKEY_SPOT_EXPIRATION,
)


DX_CC_RE = re.compile(r"^DX de (\S+):\s+(\d+\.\d)\s+(\S+)\s+(.*?)\s+?(\w+) (\d+Z)\s+(\w+)")
DX_AR_RE = re.compile(r"^DX de (\S+):\s+(\d+\.\d)\s+(\S+)\s+(.*?)\s+?(\d+Z)")

def parse_cc_dx_cluster_line(line: str) -> dict | None:
    match = DX_CC_RE.match(line.strip())
    if match:
        return {
            "spotter_callsign": match.group(1),
            "frequency": float(match.group(2)),
            "dx_callsign": match.group(3),
            "comment": match.group(4).strip(),
            "dx_locator": match.group(5),
            "time": match.group(6),
            "spotter_locator": match.group(7),
        }
    return None


def parse_ar_cluster_line(line: str) -> dict | None:
    # DX de K5TR-#:    14056.0  VE2PID/W8    CW 17 dB 22 WPM CQ             2010Z
    # DX de KB8OTK:    18100.9  OD5ZZ                                       2053Z
    match = DX_AR_RE.match(line.strip())
    if match:
        return {
            "spotter_callsign": match.group(1),
            "frequency": float(match.group(2)),
            "dx_callsign": match.group(3),
            "comment": match.group(4).strip(),
            "time": match.group(5),
            "dx_locator": "",
            "spotter_locator": "",
        }
    return None


def parse_dx_line(line: str):
    spot = parse_cc_dx_cluster_line(line)
    if spot is None:
        spot = parse_ar_cluster_line(line)

    if spot is None:
        return None

    spot["spotter_callsign"] = re.sub(r"-\d+$", "", spot["spotter_callsign"])

    if spot["spotter_callsign"].upper() == "W3LPL":
        return None
    else:
        return spot


async def telnet_and_collect(host, port, username, telnet_log_dir, output_queue: asyncio.Queue, debug: bool = False):
    """
    Establishes a Telnet connection, sends a username, and collects spots.
    If the connection is lost, it attempts to reconnect with exponential backoff.
    Push spots to output_queue for processing.
    """
    reconnect_attempts = 0
    backoff_delays = [60, 300, 600, 1200, 2400, 3600]  # 1, 5, 10, 20, 40, 60 minutes

    log_filename_prefix = os.path.join(telnet_log_dir, host)
    if debug:
        logger.debug(f"{log_filename_prefix=}")
    task_logger = open_log_file2(log_filename_prefix=log_filename_prefix, debug=debug)

    task_logger.info(f"Start of telnet_and_collect for {host}. {debug=}")
    valkey_client = get_valkey_client(host=VALKEY_HOST, port=VALKEY_PORT, db=VALKEY_DB)

    while True:
        reader, writer = None, None
        line_buffer = b""
        try:
            logger.info(f"Attempting to connect to {host}:{port} ...")
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, int(port)),
                timeout=10
            )

            logger.info(f"{host}:{port}  Successfully connected")
            reconnect_attempts = 0

            if username:
                await asyncio.sleep(2)
                writer.write(f"{username}\n".encode("utf-8"))
                await writer.drain()
                if debug:
                    task_logger.debug(f"Sent username: {username}")

            while True:
                data = await reader.read(4096)
                if not data:
                    task_logger.error("Connection closed by remote host.")
                    break

                lines = (line_buffer + data).split(b"\n")
                line_buffer = lines.pop()

                for line_bytes in lines:
                    line = line_bytes.decode("utf-8", errors="ignore").replace("\r", "")
                    task_logger.info(line)
                    if line.startswith("DX de"):
                        spot = parse_dx_line(line)
                        if spot:
                            cluster = f"{host}:{port}"
                            spot.update({"cluster": cluster})
                            spot_data = json.dumps(spot)
                            if debug:
                                task_logger.debug(json.dumps(spot, indent=2))
                                logger.debug(json.dumps(spot, indent=2))

                            try:
                                spot_key = f"{spot['time']}:{spot['dx_callsign']}:{spot['frequency']}:{spot['spotter_callsign']}"
                                added = await valkey_client.set(spot_key, 1, ex=VALKEY_SPOT_EXPIRATION, nx=True)
                                if added:
                                    await output_queue.put(spot)
                                    if debug:
                                        task_logger.debug(f"Spot added to queue: {spot_data}")
                                        logger.debug(f"Spot added to queue: {host}:{port}  {spot_data}")
                                else:
                                    if debug:
                                        task_logger.debug(f"Duplicate spot not queued: {spot_data}")
                                        logger.debug(f"Duplicate spot not queued: {host}:{port}  {spot_data}")

                            except Exception as e:
                                task_logger.error(f"**** Failed to queue spot: {e}")
                        else:
                            task_logger.error(f"Could not parse spot line: {line}")

        except (asyncio.TimeoutError, ConnectionRefusedError, OSError) as e:
            task_logger.exception(f"Connection failed: {host}:{port}  {e}")
            logger.exception(f"Connection failed: {host}:{port}  {e}")

        except asyncio.CancelledError:
            logger.info(f"{host}:{port} Task cancelled, shutting down.")
            break

        except Exception as ex:
            message = f"**** ERROR telnet_and_collect **** An exception of type {type(ex).__name__} occured. Arguments: {ex.args}"
            task_logger.exception(message)
            logger.exception(message)

        finally:
            if writer:
                writer.close()
                await writer.wait_closed()

        # Exponential backoff logic
        if reconnect_attempts < len(backoff_delays):
            delay = backoff_delays[reconnect_attempts]
        else:
            delay = backoff_delays[-1]

        task_logger.info(
            f"{host}:{port} Reconnection attempt {reconnect_attempts + 1}. Waiting for {delay // 60} minutes before retrying."
        )
        logger.info(
            f"{host}:{port} Reconnection attempt {reconnect_attempts + 1}. Waiting for {delay // 60} minutes before retrying."
        )

        try:
            await asyncio.sleep(delay)
            reconnect_attempts += 1
        except asyncio.CancelledError:
            logger.info(f"{host}:{port} Task cancelled during backoff.")
            break
