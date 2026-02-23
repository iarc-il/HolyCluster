import asyncio
import json

import websockets
from loguru import logger

from monitor.state import CheckState, HealthStatus


async def check_websocket(ws_url: str, state: CheckState, timeout: float = 30) -> str | None:
    try:
        async with asyncio.timeout(timeout):
            async with websockets.connect(ws_url) as ws:
                await ws.send(json.dumps({"initial": True}))
                response = await ws.recv()
                data = json.loads(response)
                if data.get("type") == "initial":
                    return state.update(HealthStatus.HEALTHY, f"WebSocket OK, got {len(data.get('spots', []))} spots")
                return state.update(HealthStatus.UNHEALTHY, f"Unexpected response: {data.get('type')}")
    except TimeoutError:
        return state.update(HealthStatus.UNHEALTHY, "WebSocket connection timed out")
    except Exception as e:
        logger.debug(f"WebSocket check failed: {e}")
        return state.update(HealthStatus.UNHEALTHY, f"WebSocket error: {e}")
