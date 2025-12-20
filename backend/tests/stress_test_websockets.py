#!/usr/bin/env python3

import argparse
import asyncio
import json
import logging
import sys
import time
from dataclasses import dataclass
from typing import List, Optional

import psycopg2
import websockets


@dataclass
class Metrics:
    timestamp: float
    active_connections: int
    memory_mb: float
    db_connections: int
    messages_received: int
    errors: int


class StressTest:
    def __init__(
        self,
        websocket_url: str,
        num_connections: int,
        duration: int,
        db_host: str = "localhost",
        db_port: int = 5432,
        db_name: str = "holy_cluster",
        db_user: str = None,
        db_password: str = None,
        api_container: str = "api",
    ):
        self.websocket_url = websocket_url
        self.num_connections = num_connections
        self.duration = duration
        self.db_config = {
            "host": db_host,
            "port": db_port,
            "database": db_name,
            "user": db_user,
            "password": db_password,
        }
        self.api_container = api_container

        self.active_connections = 0
        self.messages_received = 0
        self.errors = 0
        self.metrics_history: List[Metrics] = []
        self.running = True

        logging.basicConfig(
            # filename="log.log",
            # filemode="a",
            level=logging.INFO,
            format="%(asctime)s - %(levelname)s - %(message)s",
        )
        self.logger = logging.getLogger(__name__)

    def get_api_memory_usage(self) -> Optional[float]:
        try:
            import subprocess

            result = subprocess.run(
                [
                    "docker",
                    "stats",
                    self.api_container,
                    "--no-stream",
                    "--format",
                    "{{.MemUsage}}",
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                mem_str = result.stdout.strip().split("/")[0].strip()
                if "MiB" in mem_str:
                    return float(mem_str.replace("MiB", ""))
                elif "GiB" in mem_str:
                    return float(mem_str.replace("GiB", "")) * 1024
            return None
        except Exception as e:
            self.logger.warning(f"Could not get docker stats: {e}")
            return None

    def get_db_connection_count(self) -> Optional[int]:
        try:
            conn = psycopg2.connect(**self.db_config)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = %s AND state = 'active'",
                (self.db_config["database"],),
            )
            count = cursor.fetchone()[0]
            cursor.close()
            conn.close()
            return count
        except Exception as e:
            self.logger.warning(f"Could not query database: {e}")
            return None

    async def websocket_client(self, client_id: int):
        connected = False
        try:
            async with websockets.connect(self.websocket_url) as websocket:
                self.active_connections += 1
                connected = True
                self.logger.debug(f"Client {client_id} connected")

                await websocket.send(json.dumps({"initial": True}))

                while self.running:
                    try:
                        _ = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                        self.messages_received += 1
                        self.logger.debug(f"Client {client_id} received message")
                    except asyncio.TimeoutError:
                        continue
                    except websockets.exceptions.ConnectionClosed:
                        break

        except Exception as e:
            self.errors += 1
            self.logger.exception(f"Client {client_id} error: {e}")
        finally:
            if connected:
                self.active_connections -= 1
            self.logger.debug(f"Client {client_id} disconnected")

    async def metrics_collector(self):
        start_time = time.time()
        sample_interval = 5

        while self.running and ((time.time() - start_time) < self.duration):
            memory_mb = self.get_api_memory_usage()
            # db_connections = self.get_db_connection_count()

            metric = Metrics(
                timestamp=time.time() - start_time,
                active_connections=self.active_connections,
                memory_mb=memory_mb or 0,
                db_connections=0,
                messages_received=self.messages_received,
                errors=self.errors,
            )
            self.metrics_history.append(metric)

            self.logger.info(
                f"⏱️  {metric.timestamp:.0f}s | "
                f"WS: {metric.active_connections}/{self.num_connections} | "
                f"MEM: {metric.memory_mb:.1f}MB | "
                f"DB: {metric.db_connections} | "
                f"MSG: {metric.messages_received} | "
                f"ERR: {metric.errors}"
            )

            await asyncio.sleep(sample_interval)

        self.running = False

    async def run(self):
        self.logger.info(
            f"Starting stress test with {self.num_connections} connections for {self.duration}s"
        )
        self.logger.info(f"WebSocket URL: {self.websocket_url}")
        self.logger.info(f"API Container: {self.api_container}")

        tasks = []

        tasks.append(asyncio.create_task(self.metrics_collector()))

        for i in range(self.num_connections):
            await asyncio.sleep(0.2)
            task = asyncio.create_task(self.websocket_client(i))
            tasks.append(task)

        await asyncio.gather(*tasks, return_exceptions=True)

        self.print_summary()

    def print_summary(self):
        if not self.metrics_history:
            self.logger.error("No metrics collected")
            return

        print("\n" + "=" * 80)
        print("STRESS TEST SUMMARY")
        print("=" * 80)

        print("\nTest Configuration:")
        print(f"  WebSocket URL: {self.websocket_url}")
        print(f"  Target Connections: {self.num_connections}")
        print(f"  Duration: {self.duration}s")
        print(f"  Samples Collected: {len(self.metrics_history)}")

        initial = self.metrics_history[0]
        final = self.metrics_history[-1]

        print("\nConnection Statistics:")
        print(
            f"  Max Active Connections: {max(m.active_connections for m in self.metrics_history)}"
        )
        print(f"  Total Messages Received: {final.messages_received}")
        print(f"  Total Errors: {final.errors}")

        if initial.memory_mb > 0 and final.memory_mb > 0:
            memory_increase = final.memory_mb - initial.memory_mb
            memory_per_conn = (
                memory_increase / self.num_connections
                if self.num_connections > 0
                else 0
            )
            print("\nMemory Usage:")
            print(f"  Initial: {initial.memory_mb:.1f} MB")
            print(f"  Final: {final.memory_mb:.1f} MB")
            print(
                f"  Increase: {memory_increase:.1f} MB ({memory_increase / initial.memory_mb * 100:.1f}%)"
            )
            print(f"  Per Connection: ~{memory_per_conn:.2f} MB")

        if initial.db_connections > 0 and final.db_connections > 0:
            db_increase = final.db_connections - initial.db_connections
            print("\nDatabase Connections:")
            print(f"  Initial: {initial.db_connections}")
            print(f"  Final: {final.db_connections}")
            print(f"  Increase: {db_increase}")

        print("\nTimeline:")
        for metric in self.metrics_history[::2]:
            print(
                f"  {metric.timestamp:6.0f}s: "
                f"WS={metric.active_connections:3d} "
                f"MEM={metric.memory_mb:6.1f}MB "
                f"DB={metric.db_connections:3d}"
            )

        print("\n" + "=" * 80)

        if final.memory_mb > initial.memory_mb * 1.5:
            print("⚠️  WARNING: Significant memory increase detected!")
            print("   This indicates a memory leak or inefficient resource usage.")

        if final.db_connections > self.num_connections:
            print("⚠️  WARNING: Database connections exceed websocket connections!")
            print("   This indicates connection pooling issues.")

        print("=" * 80 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="WebSocket stress test for HolyCluster API"
    )
    parser.add_argument(
        "--url",
        default="ws://localhost:8000/spots_ws",
        help="WebSocket URL (default: ws://localhost:8000/spots_ws)",
    )
    parser.add_argument(
        "--connections",
        type=int,
        default=50,
        help="Number of concurrent connections (default: 50)",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=300,
        help="Test duration in seconds (default: 300)",
    )
    parser.add_argument(
        "--db-host",
        default="localhost",
        help="Database host (default: localhost)",
    )
    parser.add_argument(
        "--db-port",
        type=int,
        default=5432,
        help="Database port (default: 5432)",
    )
    parser.add_argument(
        "--db-name",
        default="holy_cluster",
        help="Database name (default: holy_cluster)",
    )
    parser.add_argument(
        "--db-user",
        help="Database user (if not provided, reads from env)",
    )
    parser.add_argument(
        "--db-password",
        help="Database password (if not provided, reads from env)",
    )
    parser.add_argument(
        "--api-container",
        default="api",
        help="Docker container name for API server (default: api)",
    )

    args = parser.parse_args()

    if not args.db_user:
        import os

        args.db_user = os.getenv("PSQL_USERNAME")
        args.db_password = os.getenv("PSQL_PASSWORD")

    if not args.db_user or not args.db_password:
        print(
            "Error: Database credentials not provided. Use --db-user/--db-password or set PSQL_USERNAME/PSQL_PASSWORD"
        )
        sys.exit(1)

    test = StressTest(
        websocket_url=args.url,
        num_connections=args.connections,
        duration=args.duration,
        db_host=args.db_host,
        db_port=args.db_port,
        db_name=args.db_name,
        db_user=args.db_user,
        db_password=args.db_password,
        api_container=args.api_container,
    )

    try:
        asyncio.run(test.run())
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        test.running = False


if __name__ == "__main__":
    main()
