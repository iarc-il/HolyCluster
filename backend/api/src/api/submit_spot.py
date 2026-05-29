import asyncio
import re

import redis.asyncio
from loguru import logger

from api.settings import settings
from shared.metrics import push_exception_event

CLUSTER_HOST = "dxc.ai9t.com"
CLUSTER_PORT = 7300
CONNECT_TIMEOUT_SECONDS = 3
EXPECT_TIMEOUT_SECONDS = 10
WRITE_TIMEOUT_SECONDS = 5
WRITER_CLOSE_TIMEOUT_SECONDS = 5.0
SUBMIT_MAX_ATTEMPTS = 5
INITIAL_RETRY_BACKOFF_SECONDS = 0.5
MAX_RETRY_BACKOFF_SECONDS = 4

logger.add(settings.spots_log_path, level="DEBUG")


class UserInputError(Exception):
    pass


class InvalidSpotter(UserInputError):
    def __str__(self):
        return "Invalid spotter"


class InvalidDXCallsign(UserInputError):
    def __str__(self):
        return "Invalid dx callsign"


class EmptyDXCallsign(UserInputError):
    def __str__(self):
        return "Empty dx callsign"


class InvalidFrequency(UserInputError):
    def __str__(self):
        return "Invalid frequency"


class RetryableClusterError(Exception):
    phase = "cluster"


class InitialConnectionFailed(RetryableClusterError):
    phase = "initial_prompt"

    def __str__(self):
        return "Initial connection failed"


class LoginFailed(RetryableClusterError):
    phase = "login"

    def __str__(self):
        return "Login failed"


class CommandError(Exception):
    def __init__(self, command):
        self.command = command

    def __str__(self):
        return f"Invalid command: {self.command}"


class DXError(Exception):
    def __str__(self):
        return "DX error"


class SpotNotSubmitted(Exception):
    def __init__(self, phase="wait_confirmation"):
        self.phase = phase

    def __str__(self):
        return "Spot submission status is unknown"


class ClusterConnectionFailed(RetryableClusterError):
    phase = "connect"

    def __str__(self):
        return "Failed to connect to the cluster"


class ClusterConnectionClosed(RetryableClusterError):
    def __init__(self, phase):
        self.phase = phase

    def __str__(self):
        return f"Cluster connection closed during {self.phase}"


class ClusterWriteFailed(RetryableClusterError):
    def __init__(self, phase):
        self.phase = phase

    def __str__(self):
        return f"Failed to write to cluster during {self.phase}"


async def expect_lines_inner(reader, valid_line, invalid_lines, phase):
    while True:
        line_bytes = await reader.readline()
        if not line_bytes:
            raise ClusterConnectionClosed(phase)

        line = line_bytes.decode("utf-8", "ignore")

        if isinstance(valid_line, re.Pattern):
            if valid_line.search(line) is not None:
                logger.info(f"Output: {line.strip()} is matching regex {valid_line}")
                return
        elif valid_line in line:
            logger.info(f"Output: {line.strip()} is matching string {valid_line}")
            return
        else:
            logger.info(f"Output: {repr(line)} not matching {repr(valid_line)}")

        for invalid_line, exception in invalid_lines.items():
            if invalid_line in line:
                raise exception


async def expect_lines(reader, valid_line, invalid_lines, default_exception=None, phase="cluster_response"):
    try:
        await asyncio.wait_for(
            expect_lines_inner(reader, valid_line, invalid_lines, phase), timeout=EXPECT_TIMEOUT_SECONDS
        )
    except TimeoutError:
        logger.warning(f"Got timeout while waiting for: {valid_line}")
        if default_exception is not None:
            raise default_exception


async def connect_to_server():
    try:
        return await asyncio.wait_for(
            asyncio.open_connection(CLUSTER_HOST, CLUSTER_PORT), timeout=CONNECT_TIMEOUT_SECONDS
        )
    except (TimeoutError, ConnectionError, OSError) as e:
        raise ClusterConnectionFailed() from e


async def write_to_cluster(writer, data, phase):
    try:
        writer.write(data.encode())
        await asyncio.wait_for(writer.drain(), timeout=WRITE_TIMEOUT_SECONDS)
    except (TimeoutError, ConnectionError, OSError, RuntimeError) as e:
        raise ClusterWriteFailed(phase) from e


async def close_writer(writer):
    try:
        writer.close()
        await asyncio.wait_for(writer.wait_closed(), timeout=WRITER_CLOSE_TIMEOUT_SECONDS)
    except (TimeoutError, ConnectionError, OSError) as e:
        logger.warning(f"Error closing cluster connection: {e}")


async def submit_spot_once(data):
    if data["spotter_callsign"] == "":
        raise InvalidSpotter()
    if data["dx_callsign"] == "":
        raise EmptyDXCallsign()

    try:
        freq = float(data["freq"])
    except (ValueError, TypeError):
        raise InvalidFrequency()

    writer = None
    command_sent = False
    try:
        reader, writer = await connect_to_server()
        await expect_lines(
            reader,
            "Please enter your call:",
            {},
            InitialConnectionFailed(),
            phase="initial_prompt",
        )

        await write_to_cluster(writer, f"{data['spotter_callsign']}\n", "login")
        await expect_lines(
            reader,
            "Hello",
            {"is not a valid callsign": InvalidSpotter()},
            LoginFailed(),
            phase="login",
        )

        if data.get("testing"):
            command = "DXTEST"
        else:
            command = "DX"

        spot_command = f"{command} {freq} {data['dx_callsign']} {data['comment']}\n"
        logger.info(f"Command: {spot_command}")
        command_sent = True
        await write_to_cluster(writer, spot_command, "submit_command")

        regex = re.compile(rf"DX de\s*{data['spotter_callsign']}:\s*{freq}\s*{data['dx_callsign']}")
        await expect_lines(
            reader,
            regex,
            {
                "command error": CommandError(spot_command),
                "Error - DX": DXError(),
                "Error - invalid frequency": InvalidFrequency(),
                "Error - Invalid Dx Call": InvalidDXCallsign(),
            },
            SpotNotSubmitted(),
            phase="wait_confirmation",
        )
    except RetryableClusterError as e:
        if command_sent:
            raise SpotNotSubmitted(e.phase) from e
        raise
    finally:
        if writer:
            await close_writer(writer)


async def submit_spot_with_retries(data):
    for attempt in range(1, SUBMIT_MAX_ATTEMPTS + 1):
        try:
            await submit_spot_once(data)
            return attempt
        except RetryableClusterError as e:
            if attempt == SUBMIT_MAX_ATTEMPTS:
                logger.error(f"Spot submit failed after {attempt} attempts: {e.__class__.__name__}: {e}")
                raise

            delay = min(INITIAL_RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1)), MAX_RETRY_BACKOFF_SECONDS)
            logger.warning(
                f"Spot submit attempt {attempt}/{SUBMIT_MAX_ATTEMPTS} failed during {e.phase}: "
                f"{e.__class__.__name__}: {e}. Retrying in {delay:.1f}s"
            )
            await asyncio.sleep(delay)

    raise ClusterConnectionFailed()


async def handle_one_spot(websocket, valkey: redis.asyncio.Redis):
    data = await websocket.receive_json()

    try:
        attempts = await submit_spot_with_retries(data)
        await websocket.send_json({"status": "success", "attempts": attempts})
        logger.info(f"Spot submitted successfully after {attempts} attempt(s): {data}")
    except UserInputError as e:
        response = {
            "status": "failure",
            "type": e.__class__.__name__,
            "error_data": str(e),
        }
        logger.info(f"Invalid user input for spot: {data}, Response: {response}")
        await websocket.send_json(response)
    except Exception as e:
        response = {
            "status": "failure",
            "type": e.__class__.__name__,
            "error_data": str(e),
        }
        if getattr(e, "phase", None):
            response["phase"] = e.phase
        logger.exception(f"Failed to submit spot: {data}, Response: {response}")
        await push_exception_event(valkey, "submit_spot", f"{e.__class__.__name__}: {e}, Spot: {data}")
        await websocket.send_json(response)
