import socket
import argparse
import os
import time
import re
import json
from loguru import logger
from valkey_config import get_valkey_client

def parse_dx_line(line: str, cluster_type: str, host: str, port: int):
    spot = {
        "spotter_callsign": None,
        "frequency": None,
        "dx_callsign": None,
        "comment": None,
        "dx_locator": None,
        "time": None,
        "spotter_locator": None,
    }
    try:
        # cc-cluster & dx-cluster
        DX_RE = re.compile(
        r"^DX de (\S+):\s+(\d+\.\d)\s+(\S+)\s+(.*?)\s+?(\w+) (\d+Z)\s+(\w+)"
        )
        match = DX_RE.match(line.strip())
        if match:
            spot["spotter_callsign"] = match.group(1)
            spot["frequency"] = float(match.group(2))
            spot["dx_callsign"] = match.group(3)
            spot["comment"] = match.group(4).strip()
            spot["dx_locator"] = match.group(5)
            spot["time"] = match.group(6)
            spot["spotter_locator"] = match.group(7)
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
            logger.error(f"Error parse_dx_line: {e}   {host=} {port=} {cluster_type=}")

    return None

def parse_show_dx_line(line: str, host: str, port: int):
    spot = {
        "spotter_callsign": None,
        "frequency": None,
        "dx_callsign": None,
        "comment": None,
        "dx_locator": None,
        "time": None,
        "spotter_locator": None,
    }
    try:
        # Format: 18075.0  E51KEE      08-Aug-2025 1723Z  Heard in CA                  <W3LPL-3>
        SHOW_DX_RE = re.compile(r"^\s*(\d+\.\d+)\s+(\S+)\s+\d{2}-\w{3}-\d{4}\s+(\d{4}Z)\s+(.*?)\s+<(\S+)>$")
        match = SHOW_DX_RE.match(line.strip())
        if match:
            spot["frequency"] = float(match.group(1))
            spot["dx_callsign"] = match.group(2)
            spot["time"] = match.group(3)
            spot["comment"] = match.group(4).strip()
            spot["spotter_callsign"] = match.group(5)
            return spot
    except Exception as e:
        logger.error(f"Error parse_show_dx_line: {e}   {host=} {port=}")
    return None

def telnet_and_collect(host, port, username, cluster_type, telnet_log_dir):
    """
    Establishes a Telnet connection, sends a username, and collects spots.
    If the connection is lost, it attempts to reconnect with exponential backoff.
    """
    reconnect_attempts = 0
    backoff_delays = [60, 300, 600, 1200, 2400, 3600]  # 1, 5, 10, 20, 40, 60 minutes

    timestamp = time.strftime("%Y%m%d-%H%M%S")
    output_filename = f"{timestamp}-{host}.txt"
    output_filepath = os.path.join(telnet_log_dir, output_filename)

    # Prepare the fixed-width cluster information string
    cluster_info = f"{host}:{port} ({cluster_type})"
    padded_cluster_info = f"{cluster_info:<45}" # Pad to 45 characters

    file_format = "[{time:YYYY-MM-DD HH:mm:ss}] {level: <8} {extra[cluster_info_padded]} | {function}:{line} - {message}"
    logger.add(output_filepath, format=file_format, level="INFO", rotation="10 MB", retention="7 days", enqueue=True, backtrace=True, diagnose=True, filter=lambda record: record["extra"].get("host") == host)

    log = logger.bind(host=host, port=port, cluster_type=cluster_type, cluster_info_padded=padded_cluster_info)

    valkey_client = get_valkey_client()

    with open(output_filepath, 'a') as f:
        f.write('\n\n')

    while True:
        sock = None
        line_buffer = b'' # Reset line_buffer for each new connection attempt
        try:
            log.info(f"Attempting to connect...")
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(10)
            sock.connect((host, int(port)))
            sock.settimeout(None)

            log.success(f"Successfully connected")
            reconnect_attempts = 0

            if username:
                time.sleep(2) # Wait for 2 seconds before sending username
                sock.sendall(f"{username}\n".encode('utf-8'))
                log.info(f"Sent username: {username}")

            # Issue 'show/dx 100' command
            sock.sendall(f"show/dx 100\n".encode('utf-8'))
            log.info(f"Sent command: show/dx 100")

            # Read and parse initial DX spots from 'show/dx 100' command
            while True:
                data = sock.recv(4096)
                if not data:
                    log.warning("Connection closed by remote host during initial DX read.")
                    break

                lines = (line_buffer + data).split(b'\n')
                line_buffer = lines.pop()

                for line_bytes in lines:
                    line = line_bytes.decode('utf-8', errors='ignore').replace('\r', '')
                    log.info(line)
                    if not line.strip(): # Break on empty line (end of output)
                        break
                    if '>' in line: # Break on prompt
                        break

                    spot = parse_show_dx_line(line, host, port)
                    if spot:
                        log.info(json.dumps(spot, indent=2))
                        try:
                            spot_id = f"spot:{spot.get('time', 'UNKNOWN')}:{spot.get('dx_callsign', 'UNKNOWN')}:{spot.get('frequency', 'UNKNOWN')}:{spot.get('spotter_callsign', 'UNKNOWN')}"
                            valkey_client.hset(spot_id, mapping=spot)
                            valkey_client.expire(spot_id, 3600) # Set TTL to 1 hour (3600 seconds)
                            log.info(f"Spot stored in Valkey: {spot_id}")
                        except Exception as e:
                            log.error(f"Failed to store spot in Valkey: {e}")
                    else:
                        log.warning(f"Could not parse show/dx line: {line}")
                if not line.strip() or '>' in line: # Break outer loop if terminator found
                    break

            
            while True:
                data = sock.recv(4096)
                if not data:
                    log.warning("Connection closed by remote host.")
                    break

                lines = (line_buffer + data).split(b'\n')
                line_buffer = lines.pop()

                for line_bytes in lines:
                    line = line_bytes.decode('utf-8', errors='ignore').replace('\r', '')
                    log.info(line)
                    if line.startswith("DX de"):
                        spot = parse_dx_line(line, cluster_type, host, port)
                        if spot:
                            log.info(json.dumps(spot, indent=2))
                            try:
                                spot_id = f"spot:{spot.get('time', 'UNKNOWN')}:{spot.get('dx_callsign', 'UNKNOWN')}:{spot.get('frequency', 'UNKNOWN')}:{spot.get('spotter_callsign', 'UNKNOWN')}"
                                valkey_client.hset(spot_id, mapping=spot)
                                valkey_client.expire(spot_id, 3600) # Set TTL to 1 hour (3600 seconds)
                                log.info(f"Spot stored in Valkey: {spot_id}")
                            except Exception as e:
                                log.error(f"Failed to store spot in Valkey: {e}")
                        else:
                            log.warning(f"Could not parse spot line: {line}")

        except (socket.timeout, ConnectionRefusedError, OSError) as e:
            log.error(f"Connection failed: {e}")

        except KeyboardInterrupt:
            log.info("Exiting due to user request (Ctrl+C).")
            break

        finally:
            if sock:
                sock.close()

        # Exponential backoff logic
        if reconnect_attempts < len(backoff_delays):
            delay = backoff_delays[reconnect_attempts]
        else:
            delay = backoff_delays[-1]

        log.info(f"Reconnection attempt {reconnect_attempts + 1}. Waiting for {delay // 60} minutes before retrying.")

        try:
            time.sleep(delay)
            reconnect_attempts += 1
        except KeyboardInterrupt:
            log.info("Exiting during backoff due to user request (Ctrl+C).")
            break

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Check telnet connection to a host and port.')
    parser.add_argument('--host', required=True, help='The hostname or IP address to connect to.')
    parser.add_argument('--port', required=True, type=int, help='The port to connect to.')
    parser.add_argument('--username', default='4X0IARC', help='The username to send after connecting.')
    parser.add_argument('--cluster-type', default='unknown', help='The type of the cluster.')

    args = parser.parse_args()

    telnet_and_collect(args.host, args.port, args.username, args.cluster_type)

