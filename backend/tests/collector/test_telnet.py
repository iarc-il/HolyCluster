import asyncio
import re
import json
from loguru import logger
from misc import  open_log_file

# Cluster config
HOST = "dxusa.net"
PORT = 7300
CALLSIGN = "4X5BR-1"

def parse_dx_line(line):
  logger.debug("parse_dx_line")
  # Regex for DX spots
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
#    logger.debug(spot)
    return spot
  return None

async def connect_to_cluster(debug: bool = False):
  reader, writer = await asyncio.open_connection(HOST, PORT)
  if debug:
    logger.debug(f"Connected to cluster {HOST}:{PORT}.")

  # Wait for login prompt and send callsign
  while True:
    line = await reader.readline()
#    logger.debug(line)
    decoded_line = line.decode(errors="ignore").strip()
    if debug:
      logger.debug(decoded_line)
    #if "login" in decoded_line.lower():
    writer.write((CALLSIGN + "\n").encode())
    await writer.drain()
    if debug:
      logger.debug(f"Logged in as {CALLSIGN}")
    break

  # Read and parse DX spots
  try:
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
#      logger.debug(line)
      decoded = line.decode(errors="ignore").strip()
      logger.debug(decoded)
      if decoded.startswith("DX de"):
        spot = parse_dx_line(decoded)
        if spot:
          logger.debug(json.dumps(spot, indent=2))
        else:
          logger.debug("***** Could not parse spot line ***")
          logger.error("\n***** Could not parse spot line ***")
          logger.error(decoded)
    logger.debug("\n")
  except asyncio.CancelledError:
    logger.debug("Disconnected.")
  finally:
    writer.close()
    await writer.wait_closed()

if __name__ == "__main__":
  debug = True
  open_log_file("logs/test_telnet")
  try:
    asyncio.run(connect_to_cluster(debug=debug))
  except KeyboardInterrupt:
    logger.debug("\nStopped by user.")

