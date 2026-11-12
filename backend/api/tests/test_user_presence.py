import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi.testclient import TestClient

from api.main import app, async_session
from api.user_presence import parse_user_id


USER_ID = "123e4567-e89b-42d3-a456-426614174000"


class UserPresenceTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.state.active_connections = set()
        app.state.active_ws_spot_connections = set()
        self.snapshot = patch("api.main.get_initial_spots", new=AsyncMock(return_value=[]))
        self.snapshot.start()
        self.addCleanup(self.snapshot.stop)

    def test_parse_user_id(self):
        self.assertEqual(parse_user_id({"user_id": USER_ID}), UUID(USER_ID))
        for value in (None, "invalid", "123e4567-e89b-12d3-a456-426614174000", 123):
            self.assertIsNone(parse_user_id({"user_id": value}))
        self.assertIsNone(parse_user_id({}))

    def test_subscription_records_user_presence(self):
        for endpoint in ("/ws", "/spots_ws"):
            with self.subTest(endpoint=endpoint):
                with patch("api.main.upsert_user_presence", new=AsyncMock()) as upsert:
                    with self.client.websocket_connect(endpoint) as socket:
                        if endpoint == "/ws":
                            socket.send_json(
                                {
                                    "version": 1,
                                    "type": "spots",
                                    "action": "initial",
                                    "user_id": USER_ID,
                                }
                            )
                        else:
                            socket.send_json({"initial": True, "user_id": USER_ID})
                        socket.receive_json()
                        upsert.assert_awaited_once_with(async_session, {UUID(USER_ID)})
                        self.assertEqual(socket.scope["user_id"], UUID(USER_ID))

    def test_invalid_identity_does_not_record_presence(self):
        with patch("api.main.upsert_user_presence", new=AsyncMock()) as upsert:
            with self.client.websocket_connect("/ws") as socket:
                socket.send_json(
                    {
                        "version": 1,
                        "type": "spots",
                        "action": "initial",
                        "user_id": "invalid",
                    }
                )
                self.assertEqual(socket.receive_json()["type"], "spots")
                upsert.assert_not_awaited()
                self.assertNotIn("user_id", socket.scope)
