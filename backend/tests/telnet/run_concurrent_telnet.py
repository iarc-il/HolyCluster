import csv
import subprocess
import os
from loguru import logger
from datetime import datetime

def run_concurrent_telnet_connections():
    """
    Reads a list of Telnet servers from a CSV file and launches a separate 
    process to connect to each server concurrently.
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # Go up two directories to the project root, then into src
    csv_path = os.path.join(script_dir, '..', '..', 'src', 'telnet_servers.csv')
    connection_script_path = os.path.join(script_dir, 'test_telnet_connection.py')

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    global_log_filename = f"all_clusters_{timestamp}.txt"
    global_log_file = os.path.join(script_dir, 'logs_telnet', global_log_filename)

    try:
        with open(csv_path, 'r') as f:
            reader = csv.DictReader(f)
            servers = list(reader)
    except FileNotFoundError:
        logger.error(f"The file {csv_path} was not found.")
        return

    processes = []
    for server in servers:
        host = server.get('hostname')
        port = server.get('port')
        cluster_type = server.get('type', 'unknown')

        if not host or not port:
            logger.warning(f"Skipping server with missing host or port: {server}")
            continue

        command = [
            'python',
            connection_script_path,
            '--host',
            host,
            '--port',
            port,
            '--global-log-file',
            global_log_file,
            '--cluster-type',
            cluster_type
        ]
        
        logger.info(f"Starting connection to {host}:{port}")
        # Launch in a new process
        process = subprocess.Popen(command)
        processes.append(process)

    # Wait for all processes to complete (optional, as they run in the background)
    for process in processes:
        try:
            process.wait()
        except KeyboardInterrupt:
            logger.info("Terminating all connections...")
            for p in processes:
                p.terminate()
            break

if __name__ == '__main__':
    run_concurrent_telnet_connections()