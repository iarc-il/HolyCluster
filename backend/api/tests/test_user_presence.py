import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from api.main import app, async_session
from test_api_metrics import value
from api.user_presence import UserPresenceObservation, merge_observations, parse_user_presence, upsert_user_presence


USER_ID = "123e4567-e89b-42d3-a456-426614174000"


class UserPresenceTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.state.active_connections = set()
        app.state.active_ws_spot_connections = set()
        self.snapshot = patch("api.main.get_initial_spots", new=AsyncMock(return_value=[]))
        self.snapshot.start()
        self.addCleanup(self.snapshot.stop)

    def test_parse_user_presence(self):
        direct = parse_user_presence(
            {
                "user_id": USER_ID,
                "ui_version": "v1.2.3",
                "catserver_version": None,
                "client_type": "desktop",
                "browser_type": "firefox",
            }
        )
        self.assertEqual(
            direct,
            UserPresenceObservation(
                user_id=UUID(USER_ID),
                ui_version="v1.2.3",
                catserver_version="none",
                client_type="desktop",
                browser_type="firefox",
                used_cat=False,
                used_direct=True,
            ),
        )
        cat = parse_user_presence(
            {
                "user_id": USER_ID,
                "catserver_version": "catserver-v1.2.3",
            }
        )
        self.assertTrue(cat.used_cat)
        self.assertFalse(cat.used_direct)
        for raw_user_id in (None, "invalid", "123e4567-e89b-12d3-a456-426614174000", 123):
            self.assertIsNone(parse_user_presence({"user_id": raw_user_id}))
        self.assertIsNone(parse_user_presence({}))

    def test_merge_observations_preserves_cat_and_direct_use(self):
        direct = parse_user_presence({"user_id": USER_ID, "catserver_version": None})
        cat = parse_user_presence({"user_id": USER_ID, "catserver_version": "catserver-v1.2.3"})

        merged = merge_observations({direct, cat})[UUID(USER_ID)]

        self.assertTrue(merged.used_cat)
        self.assertTrue(merged.used_direct)
        self.assertEqual(merged.catserver_version, "catserver-v1.2.3")

    def test_upsert_writes_presence_and_daily_activity(self):
        class Session:
            def __init__(self):
                self.statements = []
                self.committed = False

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def execute(self, statement):
                self.statements.append(statement)

            async def commit(self):
                self.committed = True

        session = Session()
        direct = parse_user_presence({"user_id": USER_ID, "catserver_version": None})
        cat = parse_user_presence({"user_id": USER_ID, "catserver_version": "catserver-v1.2.3"})

        asyncio.run(upsert_user_presence(lambda: session, {direct, cat}))

        self.assertTrue(session.committed)
        self.assertEqual(len(session.statements), 2)
        sql = [str(statement.compile(dialect=postgresql.dialect())) for statement in session.statements]
        self.assertIn("INSERT INTO anonymous_user_presence", sql[0])
        self.assertIn("ON CONFLICT (user_id) DO UPDATE", sql[0])
        self.assertIn("INSERT INTO anonymous_user_day", sql[1])
        self.assertIn("ON CONFLICT (day, user_id) DO UPDATE", sql[1])

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
                        observation = UserPresenceObservation(
                            user_id=UUID(USER_ID),
                            ui_version="not_reported",
                            catserver_version="not_reported",
                            client_type="not_reported",
                            browser_type="not_reported",
                            used_cat=False,
                            used_direct=False,
                        )
                        upsert.assert_awaited_once_with(async_session, {observation})
                        self.assertEqual(socket.scope["user_presence"], observation)

    def test_live_metrics_deduplicate_browser_identity(self):
        active = "holycluster_api_anonymous_user_active"
        connections = "holycluster_api_anonymous_user_connections_active"
        before_active = value(self.client, active)
        before_connections = value(self.client, connections)
        with patch("api.main.upsert_user_presence", new=AsyncMock()):
            with (
                self.client.websocket_connect("/ws") as first,
                self.client.websocket_connect("/ws") as second,
            ):
                for socket in (first, second):
                    socket.send_json(
                        {
                            "version": 1,
                            "type": "spots",
                            "action": "initial",
                            "user_id": USER_ID,
                        }
                    )
                    socket.receive_json()
                self.assertEqual(value(self.client, active) - before_active, 1)
                self.assertEqual(value(self.client, connections) - before_connections, 2)
        self.assertEqual(value(self.client, active), before_active)
        self.assertEqual(value(self.client, connections), before_connections)

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
                self.assertNotIn("user_presence", socket.scope)
