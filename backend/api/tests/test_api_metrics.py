import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from prometheus_client.parser import text_string_to_metric_families

from api.main import app, broadcast_spots, propagation_data_collector


def samples(client):
    response = client.get("/metrics")
    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
    return [sample for family in text_string_to_metric_families(response.text) for sample in family.samples]


def value(client, name, **labels):
    return sum(s.value for s in samples(client) if s.name == name and s.labels == labels)


class MetricsTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.state.active_connections = set()
        app.state.active_ws_spot_connections = set()

    def test_scrape_and_bounded_http(self):
        before = value(
            self.client, "holycluster_api_http_requests_total", method="GET", route="/geocache/{callsign}", status="500"
        )
        client = TestClient(app, raise_server_exceptions=False)
        with patch("api.main.async_session", side_effect=RuntimeError("private-secret")):
            client.get("/geocache/PRIVATE1")
            client.get("/geocache/PRIVATE2")
        self.assertEqual(
            value(
                self.client,
                "holycluster_api_http_requests_total",
                method="GET",
                route="/geocache/{callsign}",
                status="500",
            )
            - before,
            2,
        )
        self.client.request("PRIVATEVERB", "/private-path")
        text = self.client.get("/metrics").text
        for secret in ("PRIVATE1", "PRIVATE2", "private-secret", "PRIVATEVERB", "private-path"):
            self.assertNotIn(secret, text)
        self.assertIn('method="other"', text)

    def test_websocket_lifecycle_and_bounded_types(self):
        for endpoint in ("/ws", "/submit_spot", "/spots_ws", "/radio"):
            baseline = value(self.client, "holycluster_api_websocket_active", endpoint=endpoint)
            total = value(self.client, "holycluster_api_websocket_connections_total", endpoint=endpoint)
            with patch("api.main.get_initial_spots", new=AsyncMock(return_value=[])):
                with self.client.websocket_connect(endpoint) as websocket:
                    if endpoint == "/radio":
                        websocket.receive_json()
                    elif endpoint == "/spots_ws":
                        websocket.send_json({"initial": True})
                        websocket.receive_json()
                    else:
                        websocket.send_json({"version": 1, "type": "PRIVATE-TYPE"})
                        websocket.receive_json()
                        websocket.send_text("not-json")
                        websocket.receive_json()
            self.assertEqual(value(self.client, "holycluster_api_websocket_active", endpoint=endpoint), baseline)
            self.assertEqual(
                value(self.client, "holycluster_api_websocket_connections_total", endpoint=endpoint), total + 1
            )
        text = self.client.get("/metrics").text
        self.assertNotIn("PRIVATE-TYPE", text)
        self.assertIn('type="unknown"', text)
        self.assertIn('type="malformed"', text)
        with self.client.websocket_connect("/ws") as websocket:
            for kind in (123, ["PRIVATE-NESTED"], {"PRIVATE-KEY": "PRIVATE-VALUE"}):
                websocket.send_json({"version": 1, "type": kind})
                websocket.receive_json()
            websocket.send_json(["PRIVATE-ARRAY"])
            websocket.receive_json()
        text = self.client.get("/metrics").text
        for secret in ("PRIVATE-NESTED", "PRIVATE-KEY", "PRIVATE-VALUE", "PRIVATE-ARRAY"):
            self.assertNotIn(secret, text)

    def test_broadcast_eviction_closes_connection_once(self):
        for endpoint in ("/ws", "/submit_spot", "/spots_ws"):
            baseline = value(self.client, "holycluster_api_websocket_active", endpoint=endpoint)
            disconnected = value(self.client, "holycluster_api_websocket_disconnects_total", endpoint=endpoint)
            failures = value(self.client, "holycluster_api_spot_broadcast_send_failures_total")
            duration = value(self.client, "holycluster_api_spot_broadcast_duration_seconds_count")
            with patch("api.main.get_initial_spots", new=AsyncMock(return_value=[])):
                with self.client.websocket_connect(endpoint) as websocket:
                    if endpoint == "/spots_ws":
                        websocket.send_json({"initial": True})
                    else:
                        websocket.send_json({"version": 1, "type": "spots", "action": "initial"})
                    websocket.receive_json()
                    connections = (
                        app.state.active_connections
                        if endpoint == "/spots_ws"
                        else app.state.active_ws_spot_connections
                    )
                    server_socket = next(iter(connections))
                    with patch.object(server_socket, "send_json", new=AsyncMock(side_effect=OSError("PRIVATE-SEND"))):
                        websocket.portal.call(broadcast_spots, app, [])
                    self.assertEqual(
                        value(self.client, "holycluster_api_websocket_active", endpoint=endpoint), baseline
                    )
                    self.assertEqual(
                        value(self.client, "holycluster_api_websocket_disconnects_total", endpoint=endpoint),
                        disconnected + 1,
                    )
                self.assertEqual(value(self.client, "holycluster_api_websocket_active", endpoint=endpoint), baseline)
                self.assertEqual(
                    value(self.client, "holycluster_api_websocket_disconnects_total", endpoint=endpoint),
                    disconnected + 1,
                )
            self.assertEqual(value(self.client, "holycluster_api_spot_broadcast_send_failures_total"), failures + 1)
            self.assertEqual(value(self.client, "holycluster_api_spot_broadcast_duration_seconds_count"), duration + 1)
        self.assertNotIn("PRIVATE-SEND", self.client.get("/metrics").text)

    def test_feature_requests(self):
        for feature, path in (
            ("release_check", "/catserver/latest"),
            ("release_download", "/catserver/download"),
            ("voacap", "/voacap"),
        ):
            before = value(self.client, "holycluster_api_feature_requests_total", feature=feature)
            self.client.get(path)
            self.assertEqual(value(self.client, "holycluster_api_feature_requests_total", feature=feature), before + 1)
        before = value(self.client, "holycluster_api_feature_requests_total", feature="spot_catch_up")
        with patch("api.main.get_spots_after", new=AsyncMock(return_value=[])):
            with self.client.websocket_connect("/ws") as websocket:
                websocket.send_json({"version": 1, "type": "spots", "action": "catch_up", "last_time": 0})
                websocket.receive_json()
        self.assertEqual(
            value(self.client, "holycluster_api_feature_requests_total", feature="spot_catch_up"), before + 1
        )

    def test_spot_history_counts_returned_records(self):
        before = value(self.client, "holycluster_api_history_records_total", kind="spots")
        rows = [{"dx_callsign": "PRIVATE-HISTORY"}]
        result = MagicMock()
        result.scalars.return_value.all.return_value = rows
        session = AsyncMock()
        session.__aenter__.return_value = session
        session.execute.return_value = result
        with patch("api.main.async_session", return_value=session), patch("api.main.cleanup_spots", return_value=rows):
            self.assertEqual(self.client.get("/history?start_time=0&end_time=1").status_code, 200)
            with self.client.websocket_connect("/ws") as websocket:
                websocket.send_json({"version": 1, "type": "history", "start_time": 0, "end_time": 1})
                websocket.receive_json()
        self.assertEqual(value(self.client, "holycluster_api_history_records_total", kind="spots"), before + 2)
        self.assertNotIn("PRIVATE-HISTORY", self.client.get("/metrics").text)

    def test_propagation_run_outcomes_require_persistence(self):
        for failure in (None, RuntimeError("PRIVATE-PERSIST")):
            outcome = "error" if failure else "success"
            before = value(self.client, "holycluster_api_background_runs_total", task="propagation", outcome=outcome)
            last_success = value(
                self.client, "holycluster_api_background_last_success_timestamp_seconds", task="propagation"
            )
            with (
                patch("api.main.propagation.collect_propagation_history", new=AsyncMock(return_value={})),
                patch("api.main.propagation.latest_propagation_from_history", return_value={}),
                patch("api.main.upsert_propagation_history", new=AsyncMock(return_value=0, side_effect=failure)),
                patch("api.main.asyncio.sleep", new=AsyncMock(side_effect=asyncio.CancelledError)),
            ):
                with self.assertRaises(asyncio.CancelledError):
                    asyncio.run(propagation_data_collector(app))
            self.assertEqual(
                value(self.client, "holycluster_api_background_runs_total", task="propagation", outcome=outcome),
                before + 1,
            )
            if failure:
                self.assertEqual(
                    value(self.client, "holycluster_api_background_last_success_timestamp_seconds", task="propagation"),
                    last_success,
                )
            else:
                self.assertGreater(
                    value(self.client, "holycluster_api_background_last_success_timestamp_seconds", task="propagation"),
                    last_success,
                )

    def test_propagation_history_counts_returned_samples(self):
        before = value(self.client, "holycluster_api_history_records_total", kind="propagation")
        feature = value(self.client, "holycluster_api_feature_requests_total", feature="propagation_history")
        result = {"metrics": {"sfi": [{"timestamp": 1, "value": 2}], "k_index": []}}
        with patch("api.main.get_propagation_history_data", new=AsyncMock(return_value=result)):
            self.assertEqual(self.client.get("/propagation/history?start_time=0&end_time=2").status_code, 200)
        self.assertEqual(value(self.client, "holycluster_api_history_records_total", kind="propagation"), before + 1)
        self.assertEqual(
            value(self.client, "holycluster_api_feature_requests_total", feature="propagation_history"), feature + 1
        )
