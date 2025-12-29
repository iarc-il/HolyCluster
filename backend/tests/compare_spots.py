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
class SpotId:
    spotter_callsign: str
    dx_callsign: str
    freq: float
    time: float

    def __eq__(self, other):
        """Compare spots with 60-second time tolerance."""
        if not isinstance(other, SpotId):
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
    id: SpotId
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
        id = SpotId(
            spotter_callsign=spot_data["spotter_callsign"],
            dx_callsign=spot_data["dx_callsign"],
            freq=spot_data["freq"],
            time=spot_data["time"],
        )

        return cls(
            id=id,
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
    def __init__(self, name: str, url: str, on_spots_callback=None):
        self.name = name
        self.url = url
        self.spots: Dict[SpotId, FullSpot] = {}
        self.running = False
        self.websocket = None
        self.on_spots_callback = on_spots_callback

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
            new_spots = []

            for spot_data in spots:
                logger.debug(f"[{self.name}] Spot: {spot_data}")
                try:
                    full_spot = FullSpot.from_json(spot_data, arrival_time)
                    self.spots[full_spot.id] = full_spot
                    new_spots.append(full_spot)
                except (KeyError, ValueError) as e:
                    logger.warning(f"[{self.name}] Failed to parse spot: {e}")

            if new_spots and self.on_spots_callback:
                await self.on_spots_callback(new_spots)

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
        self.check_delay = 180
        self.checked_spots = set()

    async def on_ref_spots_received(self, spots: List[FullSpot]):
        for spot in spots:
            asyncio.create_task(self._check_spot_after_delay(spot))

    async def _check_spot_after_delay(self, spot: FullSpot):
        await asyncio.sleep(self.check_delay)

        if spot.id in self.checked_spots:
            return

        self.checked_spots.add(spot.id)

        if spot.id not in self.target_monitor.spots:
            self._print_missing_spot(spot)
            self.missing_count += 1

    def _print_missing_spot(self, spot: FullSpot):
        spot_time = datetime.fromtimestamp(spot.id.time, tz=timezone.utc)
        time_str = spot_time.strftime("%Y-%m-%d %H:%M:%S UTC")

        print("\n" + "=" * 80)
        print("Missing spot detected:")
        print(f"  DX:        {spot.id.dx_callsign}")
        print(f"  Spotter:   {spot.id.spotter_callsign}")
        print(f"  Frequency: {spot.id.freq} MHz")
        print(f"  Time:      {time_str}")
        print("=" * 80)

    async def run(self):
        self.running = True
        self.ref_monitor.on_spots_callback = self.on_ref_spots_received
        self.ref_monitor.start()
        self.target_monitor.start()

        tasks = [
            asyncio.create_task(self.ref_monitor.connect_and_monitor()),
            asyncio.create_task(self.target_monitor.connect_and_monitor()),
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
        help="Reference server WebSocket URL",
    )
    parser.add_argument(
        "--target-server",
        help="Target server WebSocket URL",
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
