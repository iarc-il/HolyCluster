import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from api import metrics
from api.main import app, broadcast_spots
from test_api_metrics import value


ACTIVE = "holycluster_api_client_version_active"
REPORTS = "holycluster_api_client_version_reports_total"


class ClientVersionMetricsTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.state.active_connections = set()
        app.state.active_ws_spot_connections = set()
        self.snapshot = patch("api.main.get_initial_spots", new=AsyncMock(return_value=[]))
        self.snapshot.start()
        self.addCleanup(self.snapshot.stop)
        self.catch_up = patch("api.main.get_spots_after", new=AsyncMock(return_value=[]))
        self.catch_up.start()
        self.addCleanup(self.catch_up.stop)

    def subscribe(self, socket, **metadata):
        socket.send_json({"version": 1, "type": "spots", "action": "initial", **metadata})
        self.assertEqual(socket.receive_json(), {"version": 1, "type": "spots", "event": "initial", "spots": []})

    def test_old_direct_and_cat_clients(self):
        for metadata, ui, cat in (
            ({}, "not_reported", "not_reported"),
            ({"ui_version": None, "catserver_version": None}, "development", "none"),
            ({"ui_version": "ABCDEF1234567", "catserver_version": None}, "abcdef1234567", "none"),
            (
                {"ui_version": "v1.2.3", "catserver_version": "catserver-v1.2.3-12-gabc1234"},
                "v1.2.3",
                "catserver-v1.2.3-12-gabc1234",
            ),
        ):
            labels = {"ui_version": ui, "catserver_version": cat}
            before = value(self.client, REPORTS, **labels)
            with self.client.websocket_connect("/ws") as socket:
                self.assertEqual(value(self.client, ACTIVE, **labels), 0)
                self.subscribe(socket, **metadata)
                self.assertEqual(value(self.client, ACTIVE, **labels), 1)
                self.assertEqual(value(self.client, REPORTS, **labels), before + 1)
            self.assertEqual(value(self.client, ACTIVE, **labels), 0)

    def test_retry_and_version_change(self):
        old = {"ui_version": "v2.0.0", "catserver_version": "not_reported"}
        new = {"ui_version": "v2.0.1", "catserver_version": "not_reported"}
        old_reports = value(self.client, REPORTS, **old)
        new_reports = value(self.client, REPORTS, **new)
        with self.client.websocket_connect("/ws") as socket:
            self.subscribe(socket, ui_version="v2.0.0")
            self.subscribe(socket, ui_version="v2.0.0")
            socket.send_json(
                {"version": 1, "type": "spots", "action": "catch_up", "last_time": 0, "ui_version": "v2.0.0"}
            )
            self.assertEqual(socket.receive_json(), {"version": 1, "type": "spots", "event": "update", "spots": []})
            self.assertEqual(value(self.client, REPORTS, **old), old_reports + 1)
            self.subscribe(socket, ui_version="v2.0.1")
            self.assertEqual(value(self.client, ACTIVE, **old), 0)
            self.assertEqual(value(self.client, ACTIVE, **new), 1)
            self.assertEqual(value(self.client, REPORTS, **new), new_reports + 1)
        self.assertEqual(value(self.client, ACTIVE, **new), 0)

    def test_invalid_requests_do_not_report(self):
        before = sum(s.value for s in metrics.CLIENT_VERSION_REPORTS.collect()[0].samples if s.name == REPORTS)
        with self.client.websocket_connect("/ws") as socket:
            for message in (
                {"version": 1, "type": "spots", "action": "bad"},
                {"version": 1, "type": "spots", "action": "catch_up"},
                {"version": 2, "type": "spots", "action": "initial"},
                {"version": 1, "type": "unknown"},
            ):
                socket.send_json(message)
                self.assertEqual(socket.receive_json()["type"], "error")
        after = sum(s.value for s in metrics.CLIENT_VERSION_REPORTS.collect()[0].samples if s.name == REPORTS)
        self.assertEqual(after, before)

    def test_legacy_and_broadcast_eviction(self):
        labels = {"ui_version": "v3.0.0", "catserver_version": "none"}
        for endpoint in ("/ws", "/submit_spot", "/spots_ws"):
            before = value(self.client, REPORTS, **labels)
            with self.client.websocket_connect(endpoint) as socket:
                if endpoint == "/spots_ws":
                    socket.send_json({"initial": True, "ui_version": "v3.0.0", "catserver_version": None})
                    self.assertEqual(socket.receive_json(), {"type": "initial", "spots": []})
                    connections = app.state.active_connections
                else:
                    self.subscribe(socket, ui_version="v3.0.0", catserver_version=None)
                    connections = app.state.active_ws_spot_connections
                self.assertEqual(value(self.client, ACTIVE, **labels), 1)
                server = next(iter(connections))
                with patch.object(server, "send_json", new=AsyncMock(side_effect=OSError("send failed"))):
                    socket.portal.call(broadcast_spots, app, [])
                self.assertEqual(value(self.client, ACTIVE, **labels), 0)
            self.assertEqual(value(self.client, ACTIVE, **labels), 0)
            self.assertEqual(value(self.client, REPORTS, **labels), before + 1)

    def test_malformed_versions_never_expose_raw_values(self):
        labels = {"ui_version": "invalid", "catserver_version": "invalid"}
        for ui, cat in (
            ("attacker/private\nvalue", "catserver-v1.2.3-attacker"),
            ("v1.2.3-" + "x" * 100, "catserver-v" + "9" * 100 + ".2.3"),
            (["private-array"], {"private-key": "private-value"}),
            (True, 12),
        ):
            with self.client.websocket_connect("/ws") as socket:
                self.subscribe(socket, ui_version=ui, catserver_version=cat)
                self.assertEqual(value(self.client, ACTIVE, **labels), 1)
        text = self.client.get("/metrics").text
        for raw in ("attacker", "private-array", "private-key", "private-value", "x" * 100, "9" * 100):
            self.assertNotIn(raw, text)

    def test_hard_pair_cap(self):
        with patch.object(metrics, "CLIENT_VERSION_PAIRS", set()):
            for number in range(102):
                ui = f"v99.0.{number}"
                labels = {
                    "ui_version": ui if number < 100 else "other",
                    "catserver_version": "none" if number < 100 else "other",
                }
                before = value(self.client, REPORTS, **labels)
                with self.client.websocket_connect("/ws") as socket:
                    self.subscribe(socket, ui_version=ui, catserver_version=None)
                    self.subscribe(socket, ui_version=ui, catserver_version=None)
                    self.assertEqual(value(self.client, ACTIVE, **labels), 1)
                    self.assertEqual(value(self.client, REPORTS, **labels), before + 1)
                self.assertEqual(value(self.client, ACTIVE, **labels), 0)
            self.assertEqual(len(metrics.CLIENT_VERSION_PAIRS), 100)
            text = self.client.get("/metrics").text
            self.assertNotIn("v99.0.100", text)
            self.assertNotIn("v99.0.101", text)
            with self.client.websocket_connect("/ws") as socket:
                self.subscribe(socket, ui_version="v99.0.0", catserver_version=None)
                self.assertEqual(value(self.client, ACTIVE, ui_version="v99.0.0", catserver_version="none"), 1)
