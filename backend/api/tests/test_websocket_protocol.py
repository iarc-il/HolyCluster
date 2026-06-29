import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from api.main import app, broadcast_spots


class FakeExecuteResult:
    def __init__(self, spots):
        self.spots = spots

    def scalars(self):
        return self.spots


class FakeSession:
    def __init__(self, spots):
        self.spots = spots

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, _statement):
        return FakeExecuteResult(self.spots)


class FakeWebSocket:
    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        self.messages.append(message)


class WebSocketProtocolTest(unittest.TestCase):
    def setUp(self):
        app.state.active_ws_spot_connections = set()
        self.client = TestClient(app)

    def test_ws_rejects_malformed_json(self):
        with self.client.websocket_connect("/ws") as websocket:
            websocket.send_text("not json")

            self.assertEqual(
                websocket.receive_json(),
                {
                    "version": 1,
                    "type": "error",
                    "error_type": "MalformedMessage",
                    "message": "WebSocket message must be valid JSON",
                },
            )

    def test_ws_requires_version(self):
        with self.client.websocket_connect("/ws") as websocket:
            websocket.send_json({"type": "spots"})

            self.assertEqual(
                websocket.receive_json(),
                {
                    "version": 1,
                    "type": "error",
                    "error_type": "MissingVersion",
                    "message": "Missing websocket protocol version",
                },
            )

    def test_ws_rejects_unsupported_version(self):
        with self.client.websocket_connect("/ws") as websocket:
            websocket.send_json({"version": 2, "type": "spots"})

            self.assertEqual(
                websocket.receive_json(),
                {
                    "version": 1,
                    "type": "error",
                    "error_type": "UnsupportedVersion",
                    "message": "Unsupported websocket protocol version",
                    "received_version": 2,
                },
            )

    def test_ws_returns_spots_initial_response(self):
        spots = [{"dx_callsign": "K1ABC"}]

        with (
            patch("api.main.async_session", new=lambda: FakeSession(spots)),
            patch("api.main.cleanup_spots", new=lambda raw_spots: list(raw_spots)),
            self.client.websocket_connect("/ws") as websocket,
        ):
            websocket.send_json({"version": 1, "type": "spots", "action": "initial"})

            self.assertEqual(
                websocket.receive_json(),
                {
                    "version": 1,
                    "type": "spots",
                    "event": "initial",
                    "spots": spots,
                },
            )
            self.assertEqual(len(app.state.active_ws_spot_connections), 1)

    def test_ws_returns_spots_catch_up_response(self):
        spots = [{"dx_callsign": "K2ABC"}]

        with (
            patch("api.main.async_session", new=lambda: FakeSession(spots)),
            patch("api.main.cleanup_spots", new=lambda raw_spots: list(raw_spots)),
            self.client.websocket_connect("/ws") as websocket,
        ):
            websocket.send_json({"version": 1, "type": "spots", "action": "catch_up", "last_time": 123})

            self.assertEqual(
                websocket.receive_json(),
                {
                    "version": 1,
                    "type": "spots",
                    "event": "update",
                    "spots": spots,
                },
            )
            self.assertEqual(len(app.state.active_ws_spot_connections), 1)

    def test_ws_rejects_spots_catch_up_without_last_time(self):
        with self.client.websocket_connect("/ws") as websocket:
            websocket.send_json({"version": 1, "type": "spots", "action": "catch_up"})

            self.assertEqual(
                websocket.receive_json(),
                {
                    "version": 1,
                    "type": "error",
                    "error_type": "MissingField",
                    "message": "Missing last_time",
                    "field": "last_time",
                },
            )

    def test_ws_rejects_unknown_spots_action(self):
        with self.client.websocket_connect("/ws") as websocket:
            websocket.send_json({"version": 1, "type": "spots", "action": "unknown"})

            self.assertEqual(
                websocket.receive_json(),
                {
                    "version": 1,
                    "type": "error",
                    "error_type": "UnsupportedAction",
                    "message": "Unsupported spots action",
                    "received_action": "unknown",
                },
            )
            self.assertEqual(len(app.state.active_ws_spot_connections), 0)

    def test_ws_returns_submit_success_response(self):
        valkey = object()
        app.state.valkey_client = valkey
        response = {"status": "success", "attempts": 2}
        handle_spot = AsyncMock(return_value=response)
        message = {
            "version": 1,
            "type": "submit",
            "spotter_callsign": "K1ABC",
            "dx_callsign": "K2ABC",
            "freq": 14074,
            "comment": "CQ",
        }

        with (
            patch("api.main.submit_spot.handle_spot", new=handle_spot),
            self.client.websocket_connect("/ws") as websocket,
        ):
            websocket.send_json(message)

            self.assertEqual(
                websocket.receive_json(),
                {
                    "version": 1,
                    "type": "submit",
                    "status": "success",
                    "attempts": 2,
                },
            )

        handle_spot.assert_awaited_once_with(message, valkey)

    def test_ws_returns_submit_failure_response(self):
        app.state.valkey_client = object()
        handle_spot = AsyncMock(
            return_value={
                "status": "failure",
                "type": "InvalidFrequency",
                "error_data": "Invalid frequency",
            }
        )

        with (
            patch("api.main.submit_spot.handle_spot", new=handle_spot),
            self.client.websocket_connect("/ws") as websocket,
        ):
            websocket.send_json({"version": 1, "type": "submit"})

            self.assertEqual(
                websocket.receive_json(),
                {
                    "version": 1,
                    "type": "submit",
                    "status": "failure",
                    "error_type": "InvalidFrequency",
                    "error_data": "Invalid frequency",
                },
            )

    def test_ws_returns_radio_unavailable_response(self):
        with self.client.websocket_connect("/ws") as websocket:
            websocket.send_json({"version": 1, "type": "radio"})

            self.assertEqual(
                websocket.receive_json(),
                {
                    "version": 1,
                    "type": "radio",
                    "event": "status",
                    "status": "unavailable",
                },
            )
            self.assertEqual(len(app.state.active_ws_spot_connections), 0)

    def test_ws_returns_not_implemented_for_unrouted_v1_type(self):
        with self.client.websocket_connect("/ws") as websocket:
            websocket.send_json({"version": 1, "type": "unknown"})

            self.assertEqual(
                websocket.receive_json(),
                {
                    "version": 1,
                    "type": "error",
                    "error_type": "NotImplemented",
                    "message": "WebSocket protocol v1 routing is not implemented yet",
                    "received_type": "unknown",
                },
            )

    def test_broadcast_spots_sends_legacy_and_v1_messages(self):
        legacy_websocket = FakeWebSocket()
        ws_websocket = FakeWebSocket()
        spots = [{"dx_callsign": "K1ABC"}]
        fake_app = SimpleNamespace(
            state=SimpleNamespace(
                active_connections={legacy_websocket},
                active_ws_spot_connections={ws_websocket},
            )
        )

        asyncio.run(broadcast_spots(fake_app, spots))

        self.assertEqual(legacy_websocket.messages, [{"type": "update", "spots": spots}])
        self.assertEqual(
            ws_websocket.messages,
            [
                {
                    "version": 1,
                    "type": "spots",
                    "event": "update",
                    "spots": spots,
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
