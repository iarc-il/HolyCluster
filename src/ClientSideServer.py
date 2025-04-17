from contextlib import asynccontextmanager
import asyncio
import json
import logging
import mimetypes
import socket
import webbrowser
import os
import fastapi
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketDisconnect
import httpx
import uvicorn
import websockets
import pystray
import PIL.Image

import RadioController

# This is a work around for a bug of mimetypes in the windows registry
mimetypes.init()
mimetypes.add_type("text/javascript", ".js")

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(levelname)s %(asctime)s %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
    },
    "handlers": {
        "default": {
            "formatter": "default",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stderr",
        },
    },
    "loggers": {
        "": {"handlers": ["default"], "level": "INFO"},
    },
})

logger = logging.getLogger(__name__)

HOST = "localhost"
# Port collision is very unlikely
# port = random.randint(10000, 60000)
port = 10001

proxy_url = "holycluster-dev.iarc.org"


async def start_webbrowser():
    """Waiting until the server is listening to requests"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    logger.info("Checking if the server is up")
    while True:
        result = sock.connect_ex((HOST, port))
        if result == 0:
            break
        logger.info("The server is not listening...")
        await asyncio.sleep(1)

    logger.info("The server is up, openning browser")
    sock.close()

    webbrowser.open(f"http://{HOST}:{port}/")


@asynccontextmanager
async def lifespan(app: fastapi.FastAPI):
    if os.environ.get("DUMMY") is not None:
        app.state.radio_controller = RadioController.DummyRadioController()
    else:
        app.state.radio_controller = RadioController.OmnirigRadioController()

    logger.info("Initializing radio")
    app.state.radio_controller.init_radio()

    asyncio.create_task(start_webbrowser())

    yield


app = fastapi.FastAPI(lifespan=lifespan)


@app.websocket("/radio")
async def websocket_endpoint(websocket: fastapi.WebSocket):
    await websocket.accept()
    await websocket.send_json({"status": "connected"})
    try:
        async def get_radio_details():
            while True:
                radio_data = app.state.radio_controller.get_data()
                await websocket.send_json(radio_data)
                await asyncio.sleep(5)

        async def set_radio():
            while True:
                data = await websocket.receive_json()
                mode = data.get("mode", None)
                freq = data.get("freq", None)
                rig = data.get("rig", None)
                band = data.get("band")
                band = int(band) if band is not None else None
                slot = "A"

                if mode is not None:
                    if mode.upper() == "SSB":
                        if band in (160, 80, 40):
                            mode = "LSB"
                        else:
                            mode = "USB"

                    logger.info(f"Setting mode: {mode}")
                    app.state.radio_controller.set_mode(mode)

                if freq is not None:
                    logger.info(f"Setting frequency: {freq} in slot {slot}")
                    app.state.radio_controller.set_frequency(slot, freq)

                if rig is not None:
                    logger.info(f"Setting rig: {rig}")
                    app.state.radio_controller.set_rig(rig)

                radio_data = app.state.radio_controller.get_data()
                radio_data["result"] = "success"

                await websocket.send_json(radio_data)

        await asyncio.gather(get_radio_details(), set_radio())

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")

@app.websocket("/submit_spot")
async def submit_spot_endpoint(websocket: fastapi.WebSocket):
    await websocket.accept()
    logger.info("Spot submission WebSocket connected")

    try:
        async with websockets.connect(f"ws://{proxy_url}/submit_spot") as target_ws:
            async def forward_spot_to_server():
                while True:
                    data = await websocket.receive_json()
                    logger.info(f"Forwarding spot to server: {data}")
                    # await websocket.send_json(data)
                    await target_ws.send(json.dumps(data))
            
            async def forward_response_from_server():
                while True:
                    data_str = await target_ws.recv()
                    data = json.loads(data_str)
                    logger.debug(f"Forwarding from target: {data}")
                    await websocket.send_json(data)
            
            await asyncio.gather(forward_spot_to_server(), forward_response_from_server())

    except WebSocketDisconnect:
        logger.info("Client WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket proxy error: {str(e)}")




async def proxy_to_main_server(path: str, response: fastapi.Response):
    async with httpx.AsyncClient() as client:
        result = await client.get(f"http://{proxy_url}/{path}")
        response.body = result.content
        response.status_code = result.status_code
        for (key, value) in result.headers.items():
            response.headers[key] = value
        return response

if os.environ.get("LOCAL_UI") is not None:
    @app.get("/spots")
    async def proxy_spots_request(response: fastapi.Response, request: fastapi.Request):
        return await proxy_to_main_server(f"spots?{request.query_params}", response)

    UI_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ui/dist")
    app.mount("/", StaticFiles(directory=UI_DIR, html=True), name="static")
else:
    @app.get("/{path:path}")
    async def proxy_all_requests(path: str, response: fastapi.Response, request: fastapi.Request):
        return await proxy_to_main_server(f"{path}?{request.query_params}", response)

def do_nothing():
    pass

def menu_launch_browser():
    webbrowser.open(f"http://{HOST}:{port}/")

def menu_terminate():
    icon.stop()
    os._exit(0)

# In order for the icon to be displayed, you must provide an icon
icon = pystray.Icon(
    name="HolyCluster",
    title="HolyCluster",
    icon=PIL.Image.open(os.path.join(os.path.dirname(__file__), "icon.png")),
    run_action=menu_launch_browser, 
    menu=pystray.Menu(
        pystray.MenuItem("Launch", menu_launch_browser, default=True),
        pystray.MenuItem("Terminate", menu_terminate),
        pystray.MenuItem(f"http://localhost:{port}", do_nothing),
    )
)

def main():
    icon.run_detached()
    uvicorn.run(app, host=HOST, port=port, log_config=None)
    

if __name__ == "__main__":
    main()
