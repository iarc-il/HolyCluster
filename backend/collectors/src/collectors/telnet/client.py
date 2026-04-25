import asyncio
import json
import os
import re
import socket

from loguru import logger
from shared.metrics import push_drop_event, push_exception_event, set_value

from collectors.db.valkey_config import get_valkey_client
from collectors.logging_setup import open_task_log_file
from collectors.settings import settings

DX_CC_RE = re.compile(r"^DX de (\S+):\s*(\d+\.\d+)\s+(\S+)\s+(.*?)\s+?(\w+) (\d+Z)\s+(\w+)")
DX_AR_RE = re.compile(r"^DX de (\S+):\s*(\d+\.\d+)\s+(\S+)\s+(.*?)\s+?(\d+Z)")


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

    return spot


async def telnet_and_collect(
    host,
    port,
    username,
    telnet_log_dir,
    output_queue: asyncio.Queue,
):
    """
    Establishes a Telnet connection, sends a username, and collects spots.
    If the connection is lost, it attempts to reconnect with exponential backoff.
    Push spots to output_queue for processing.
    """
    reconnect_attempts = 0
    INITIAL_BACKOFF = 60
    MAX_BACKOFF = 86400  # 1 day
    SHORT_CONNECTION_THRESHOLD = 30  # seconds

    log_filename_prefix = os.path.join(telnet_log_dir, host)
    task_logger = open_task_log_file(log_filename_prefix=log_filename_prefix)

    task_logger.info(f"Start of telnet_and_collect for {host}")
    valkey_client = get_valkey_client()

    while True:
        reader, writer = None, None
        line_buffer = b""
        try:
            logger.debug(f"Attempting to connect to {host}:{port} ...")
            reader, writer = await asyncio.wait_for(asyncio.open_connection(host, int(port)), timeout=10)
        except (TimeoutError, asyncio.TimeoutError, asyncio.CancelledError, ConnectionRefusedError, OSError, socket.gaierror) as e:
            task_logger.error(f"Connection failed: {host}:{port}  {e}")
            logger.error(f"Connection failed: {host}:{port}  {e}")
            await set_value(valkey_client, f"collector:telnet:{host}:connected", 0)
            await push_exception_event(valkey_client, "collector", f"telnet {host}:{port}: {e}")
        else:
            logger.info(f"{host}:{port}  Successfully connected")
            reconnect_attempts = 0
            await set_value(valkey_client, f"collector:telnet:{host}:connected", 1)
            connection_start_time = asyncio.get_event_loop().time()

            try:
                if username:
                    await asyncio.sleep(2)
                    writer.write(f"{username}\n".encode("utf-8"))
                    await writer.drain()

                while True:
                    try:
                        data = await asyncio.wait_for(reader.read(4096), timeout=60)
                    except (TimeoutError, asyncio.TimeoutError):
                        writer.write(b"help\n")
                        data = await asyncio.wait_for(reader.read(4096), timeout=5)

                    if not data:
                        task_logger.error("Connection closed by remote host.")
                        await set_value(valkey_client, f"collector:telnet:{host}:connected", 0)
                        connection_duration = asyncio.get_event_loop().time() - connection_start_time
                        if connection_duration < SHORT_CONNECTION_THRESHOLD:
                            task_logger.warning(
                                f"Connection lasted {connection_duration:.0f}s (<{SHORT_CONNECTION_THRESHOLD}s). Not resetting backoff."
                            )
                            reconnect_attempts += 1
                        else:
                            reconnect_attempts = 0
                        break

                    lines = (line_buffer + data).split(b"\n")
                    line_buffer = lines.pop()

                    for line_bytes in lines:
                        line = line_bytes.decode("utf-8", errors="ignore").replace("\r", "")
                        task_logger.info(line)

                        if not line.startswith("DX de"):
                            continue

                        spot = parse_dx_line(line)
                        if spot is None:
                            task_logger.error(f"Could not parse spot line: {line}")
                            logger.error(f"Could not parse spot line: {line}")
                            await push_drop_event(valkey_client, "parse_error", line)
                            continue

                        if spot["spotter_callsign"].upper() in ["W3LPL", "J9AQ"]:
                            logger.debug(f"Skipping banned spot: {spot}")
                            continue

                        cluster = f"{host}:{port}"
                        spot["cluster"] = cluster
                        spot_data = json.dumps(spot)
                        task_logger.debug(json.dumps(spot, indent=2))
                        logger.debug(json.dumps(spot, indent=2))

                        spot_key = f"{spot['time']}:{spot['dx_callsign']}:{spot['frequency']}:{spot['spotter_callsign']}"
                        added = await valkey_client.set(spot_key, 1, ex=settings.valkey_spot_expiration, nx=True)
                        try:
                            await valkey_client.xadd(
                                "stream-arrivals",
                                {"cluster": cluster, "spot_key": spot_key, "accepted": "1" if added else "0"},
                            )
                        except Exception:
                            logger.warning("Failed to write to stream-arrivals", exc_info=True)
                        if added:
                            await output_queue.put(spot)
                            task_logger.debug(f"Spot added to queue: {spot_data}")
                            logger.debug(f"Spot added to queue: {host}:{port}  {spot_data}")
                        else:
                            task_logger.debug(f"Duplicate spot not queued: {spot_data}")
                            logger.debug(f"Duplicate spot not queued: {host}:{port}  {spot_data}")
            except Exception as e:
                task_logger.exception(f"Error during collection: {e}")
                logger.exception(f"Error during collection: {e}")
                await set_value(valkey_client, f"collector:telnet:{host}:connected", 0)
                connection_duration = asyncio.get_event_loop().time() - connection_start_time
                if connection_duration < SHORT_CONNECTION_THRESHOLD:
                    task_logger.warning(
                        f"Connection lasted {connection_duration:.0f}s (<{SHORT_CONNECTION_THRESHOLD}s). Not resetting backoff."
                    )
                    reconnect_attempts += 1
                else:
                    reconnect_attempts = 0

        finally:
            if writer:
                writer.close()
                try:
                    await asyncio.wait_for(writer.wait_closed(), timeout=5.0)
                except (TimeoutError, asyncio.TimeoutError):
                    logger.warning(f"{host}:{port} Timeout waiting for writer to close")

        delay = min(INITIAL_BACKOFF * (2**reconnect_attempts), MAX_BACKOFF)

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
