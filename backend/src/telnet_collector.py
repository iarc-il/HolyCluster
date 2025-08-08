import socket
import argparse
import os
import time
from loguru import logger

def check_telnet_connection(host, port, username, cluster_type, global_log_file=None):
    """
    Establishes a Telnet connection, sends a username, and logs server output.
    If the connection is lost, it attempts to reconnect with exponential backoff.
    """
    reconnect_attempts = 0
    backoff_delays = [60, 300, 600, 1200, 2400, 3600]  # 1, 5, 10, 20, 40, 60 minutes

    log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
    os.makedirs(log_dir, exist_ok=True)

    output_filename = f"{host}.txt"
    output_filepath = os.path.join(log_dir, output_filename)

    # Prepare the fixed-width cluster information string
    cluster_info = f"{host}:{port} ({cluster_type})"
    padded_cluster_info = f"{cluster_info:<45}" # Pad to 45 characters

    # Configure Loguru
    logger.remove()
    console_format = "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{extra[cluster_info_padded]}</cyan> | <level>{message}</level>"
    file_format = "[{time:YYYY-MM-DD HH:mm:ss}] {level: <8} {extra[cluster_info_padded]} | {message}"

    logger.add(lambda msg: print(msg, end=''), format=console_format, level="INFO")
    logger.add(output_filepath, format=file_format, level="INFO", rotation="10 MB", retention="7 days", enqueue=True, backtrace=True, diagnose=True)
    if global_log_file:
        logger.add(global_log_file, format=console_format, level="INFO", enqueue=True, backtrace=True, diagnose=True)

    log = logger.bind(host=host, port=port, cluster_type=cluster_type, cluster_info_padded=padded_cluster_info)

    with open(output_filepath, 'a') as f:
        f.write('\n\n')

    while True:
        sock = None
        try:
            log.info(f"Attempting to connect...")
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(10)
            sock.connect((host, port))
            sock.settimeout(None)

            log.success(f"Successfully connected")
            reconnect_attempts = 0

            if username:
                time.sleep(2) # Wait for 2 seconds before sending username
                sock.sendall(f"{username}\n".encode('utf-8'))
                log.info(f"Sent username: {username}")

            line_buffer = b''
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
    parser.add_argument('--username', default='4X5BR', help='The username to send after connecting.')
    parser.add_argument('--global-log-file', help='Path to a global log file for all connections.')
    parser.add_argument('--cluster-type', default='unknown', help='The type of the cluster.')

    args = parser.parse_args()

    check_telnet_connection(args.host, args.port, args.username, args.cluster_type, args.global_log_file)
