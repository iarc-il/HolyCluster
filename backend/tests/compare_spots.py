#!/usr/bin/env python3

import argparse
import asyncio
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List

import websockets


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@dataclass
class SpotIdentifier:
    spotter_callsign: str
    dx_callsign: str
    freq: float
    time: float

    def __eq__(self, other):
        """Compare spots with 60-second time tolerance."""
        if not isinstance(other, SpotIdentifier):
            return False
        return (
            self.spotter_callsign == other.spotter_callsign
            and self.dx_callsign == other.dx_callsign
            and round(self.freq, 3) == round(other.freq, 3)
        )

    def __hash__(self):
        """Hash based on callsigns and rounded frequency for efficient lookups."""
        return hash((self.spotter_callsign, self.dx_callsign, round(self.freq, 3)))


@dataclass
class FullSpot:
    identifier: SpotIdentifier
    spotter_loc: List[float]
    spotter_country: str
    spotter_continent: str
    dx_loc: List[float]
    dx_country: str
    dx_continent: str
    band: str
    mode: str
    comment: str
    arrival_time: float

    @classmethod
    def from_json(cls, spot_data: dict, arrival_time: float) -> "FullSpot":
        identifier = SpotIdentifier(
            spotter_callsign=spot_data["spotter_callsign"],
            dx_callsign=spot_data["dx_callsign"],
            freq=spot_data["freq"],
            time=spot_data["time"],
        )

        return cls(
            identifier=identifier,
            spotter_loc=spot_data["spotter_loc"],
            spotter_country=spot_data["spotter_country"],
            spotter_continent=spot_data["spotter_continent"],
            dx_loc=spot_data["dx_loc"],
            dx_country=spot_data["dx_country"],
            dx_continent=spot_data["dx_continent"],
            band=spot_data["band"],
            mode=spot_data["mode"],
            comment=spot_data["comment"],
            arrival_time=arrival_time,
        )


class ServerMonitor:
    def __init__(self, name: str, url: str):
        self.name = name
        self.url = url
        self.spots: Dict[SpotIdentifier, FullSpot] = {}
        self.running = False
        self.websocket = None

    async def connect_and_monitor(self):
        while self.running:
            try:
                logger.info(f"[{self.name}] Connecting to {self.url}")
                async with websockets.connect(self.url) as websocket:
                    self.websocket = websocket
                    logger.info(f"[{self.name}] Connected successfully")

                    while self.running:
                        try:
                            message = await asyncio.wait_for(websocket.recv(), timeout=30.0)
                            data = json.loads(message)
                            await self._process_message(data)
                        except asyncio.TimeoutError:
                            continue
                        except websockets.exceptions.ConnectionClosed:
                            logger.warning(f"[{self.name}] Connection closed")
                            break

            except Exception as e:
                logger.error(f"[{self.name}] Connection error: {e}")
                if self.running:
                    logger.info(f"[{self.name}] Reconnecting in 5 seconds...")
                    await asyncio.sleep(5)

    async def _process_message(self, data: dict):
        if data.get("type") == "update":
            spots = data.get("spots", [])
            arrival_time = time.time()

            for spot_data in spots:
                try:
                    full_spot = FullSpot.from_json(spot_data, arrival_time)
                    self.spots[full_spot.identifier] = full_spot
                except (KeyError, ValueError) as e:
                    logger.warning(f"[{self.name}] Failed to parse spot: {e}")

    def get_spots_older_than(self, seconds: float) -> List[FullSpot]:
        cutoff_time = time.time() - seconds
        return [spot for spot in self.spots.values() if spot.arrival_time < cutoff_time]

    def cleanup_old_spots(self, max_age_seconds: float):
        cutoff_time = time.time() - max_age_seconds
        to_remove = [identifier for identifier, spot in self.spots.items() if spot.arrival_time < cutoff_time]
        for identifier in to_remove:
            del self.spots[identifier]

        if to_remove:
            logger.debug(f"[{self.name}] Cleaned up {len(to_remove)} old spots")

    def start(self):
        self.running = True

    def stop(self):
        self.running = False


class SpotComparator:
    def __init__(self, ref_monitor: ServerMonitor, target_monitor: ServerMonitor):
        self.ref_monitor = ref_monitor
        self.target_monitor = target_monitor
        self.running = False
        self.missing_count = 0

    async def periodic_check(self):
        check_interval = 10
        check_delay = 180

        while self.running:
            await asyncio.sleep(check_interval)

            ref_spots = self.ref_monitor.get_spots_older_than(check_delay)
            print(f"Ref spots: {len(ref_spots)}")

            for ref_spot in ref_spots:
                if ref_spot.identifier not in self.target_monitor.spots:
                    self._print_missing_spot(ref_spot)
                    self.missing_count += 1

    def _print_missing_spot(self, spot: FullSpot):
        spot_time = datetime.fromtimestamp(spot.identifier.time, tz=timezone.utc)
        time_str = spot_time.strftime("%Y-%m-%d %H:%M:%S UTC")

        band_str = f"{spot.band}m" if isinstance(spot.band, (int, float)) else spot.band

        print("\n" + "=" * 80)
        print("Missing spot detected:")
        print(f"  Spotter: {spot.identifier.spotter_callsign}")
        print(f"  DX: {spot.identifier.dx_callsign}")
        print(f"  Frequency: {spot.identifier.freq} MHz")
        print(f"  Time: {time_str}")
        print(f"  Mode: {spot.mode}, Band: {band_str}")
        print(f"  Comment: {spot.comment}")
        print(f"  Spotter location: {spot.spotter_loc} ({spot.spotter_country}, {spot.spotter_continent})")
        print(f"  DX location: {spot.dx_loc} ({spot.dx_country}, {spot.dx_continent})")
        print("=" * 80)

    async def run(self):
        self.running = True
        self.ref_monitor.start()
        self.target_monitor.start()

        tasks = [
            asyncio.create_task(self.ref_monitor.connect_and_monitor()),
            asyncio.create_task(self.target_monitor.connect_and_monitor()),
            asyncio.create_task(self.periodic_check()),
        ]

        try:
            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            logger.info("Shutting down...")
        finally:
            self.stop()

    def stop(self):
        self.running = False
        self.ref_monitor.stop()
        self.target_monitor.stop()

        print("\n" + "=" * 80)
        print("COMPARISON SUMMARY")
        print("=" * 80)
        print(f"Total missing spots detected: {self.missing_count}")
        print(f"Reference server spots: {len(self.ref_monitor.spots)}")
        print(f"Target server spots: {len(self.target_monitor.spots)}")
        print("=" * 80)


def main():
    parser = argparse.ArgumentParser(description="Compare spots between two HolyCluster API servers")
    parser.add_argument(
        "--ref-server",
        help="Reference server WebSocket URL (default: ws://localhost:8000/spots_ws)",
    )
    parser.add_argument(
        "--target-server",
        help="Target server WebSocket URL (default: ws://localhost:8001/spots_ws)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )

    args = parser.parse_args()

    if args.verbose:
        logger.setLevel(logging.DEBUG)

    print("=" * 80)
    print("SPOT COMPARISON MONITOR")
    print("=" * 80)
    print(f"Reference server: {args.ref_server}")
    print(f"Target server: {args.target_server}")
    print("Time tolerance: 60 seconds")
    print("Check delay: 3 minutes")
    print("=" * 80)
    print("\nMonitoring for missing spots... (Press Ctrl+C to stop)\n")

    ref_monitor = ServerMonitor("REF", f"wss://{args.ref_server}/spots_ws")
    target_monitor = ServerMonitor("TARGET", f"ws://{args.target_server}/spots_ws")
    comparator = SpotComparator(ref_monitor, target_monitor)

    try:
        asyncio.run(comparator.run())
    except KeyboardInterrupt:
        print("\n\nStopping comparison monitor...")
        comparator.stop()


if __name__ == "__main__":
    main()
