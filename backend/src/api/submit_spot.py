import asyncio
import logging
import re


CLUSTER_HOST = "dxc.k0xm.net"
CLUSTER_PORT = 7300


logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


class InvalidSpotter(Exception):
    def __str__(self):
        return "Invalid spotter"


class LoginFailed(Exception):
    def __str__(self):
        return "Login failed"


class CommandError(Exception):
    def __init__(self, command):
        self.command = command

    def __str__(self):
        return f"Invalid command: {self.command}"


class OtherError(Exception):
    def __str__(self):
        return "Other error"


class InvalidFrequency(Exception):
    def __str__(self):
        return "Invalid frequency"


class InvalidDXCallsign(Exception):
    def __str__(self):
        return "Invalid dx callsign"


class ClusterConnectionFailed(Exception):
    def __str__(self):
        return "Failed to connect to the cluster"


async def expect_lines_inner(reader, valid_line, invalid_lines):
    while True:
        line = await reader.readline()
        line = line.decode("utf-8", "ignore")

        print(line.strip())
        if isinstance(valid_line, re.Pattern):
            if valid_line.search(line) is not None:
                return
        elif valid_line in line:
            return
        else:
            print(f"line: {repr(line)} is not {repr(valid_line)}")
        for invalid_line, exception in invalid_lines.items():
            if invalid_line in line:
                raise exception


async def expect_lines(reader, valid_line, invalid_lines, default_exception=None):
    try:
        await asyncio.wait_for(
            expect_lines_inner(reader, valid_line, invalid_lines),
            timeout=10
        )
    except TimeoutError:
        logger.warning(f"Got timeout while waiting for: {valid_line}")
        if default_exception is not None:
            raise default_exception


async def connect_to_server():
    async def inner_connect():
        return await asyncio.open_connection(CLUSTER_HOST, CLUSTER_PORT)

    for i in range(5):
        try:
            return await asyncio.wait_for(inner_connect(), timeout=3)
        except TimeoutError:
            logger.error(f"Failed to connect to cluster at {CLUSTER_HOST}:{CLUSTER_PORT}, {i} retry")
    else:
        raise ClusterConnectionFailed()


async def handle_one_spot(websocket):
    data = await websocket.receive_json()

    try:
        if data["spotter_callsign"] == "":
            raise InvalidSpotter()
        if data["dx_callsign"] == "":
            raise InvalidDXCallsign()

        reader, writer = await connect_to_server()
        writer.write(f"{data['spotter_callsign']}\n".encode())
        await expect_lines(
            reader,
            "Hello",
            {"is not a valid callsign": InvalidSpotter()},
            LoginFailed(),
        )

        spot_command = f"DXTEST {float(data['freq'])} {data['dx_callsign']} {data['comment']}\n"
        print("Writing:", spot_command)
        writer.write(spot_command.encode())

        regex = re.compile(fr"DX de\s*{data['spotter_callsign']}:\s*{float(data['freq'])}\s*{data['dx_callsign']}")
        await expect_lines(
            reader,
            regex,
            {
                "command error": CommandError(spot_command),
                "Error - DX": OtherError(),
                "Error - invalid frequency": InvalidFrequency(),
                "Error - Invalid Dx Call": InvalidDXCallsign(),
            },
        )
        writer.close()
        await writer.wait_closed()

        await websocket.send_json({"status": "success"})
        logger.info(f"Spot submitted sucessfully: {data}")
    except Exception as e:
        response = {
            "status": "failure",
            "type": e.__class__.__name__,
            "error_data": str(e),
        }
        logger.exception(f"Failed to submit spot: {data}, Response: {response}")
        await websocket.send_json(response)
