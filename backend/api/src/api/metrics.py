import json
import re
import time
from dataclasses import dataclass
from threading import Lock

from prometheus_client import Counter, Gauge, Histogram

PREFIX = "holycluster_api_"
HTTP_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10)
BACKGROUND_BUCKETS = (0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 300)
HTTP_REQUESTS = Counter(PREFIX + "http_requests_total", "Completed HTTP requests", ["method", "route", "status"])
HTTP_DURATION = Histogram(
    PREFIX + "http_request_duration_seconds",
    "Complete HTTP request duration",
    ["method", "route"],
    buckets=HTTP_BUCKETS,
)
CLIENT_VERSION_ACTIVE = Gauge(
    PREFIX + "client_version_active", "Open spot subscribers by client release", ["ui_version", "catserver_version"]
)
CLIENT_VERSION_REPORTS = Counter(
    PREFIX + "client_version_reports_total", "Changed client release reports", ["ui_version", "catserver_version"]
)
CLIENT_VERSION_PAIRS = set()
CLIENT_VERSION_PAIR_LOCK = Lock()
UI_SHA = re.compile(r"[0-9a-fA-F]{7,40}")
UI_TAG = re.compile(
    r"v?[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?"
)
CAT_TAG = re.compile(r"catserver-v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9]+-g[0-9a-fA-F]{7,40})?")
WS_ACTIVE = Gauge(PREFIX + "websocket_active", "Accepted open connections", ["endpoint"])
WS_TOTAL = Counter(PREFIX + "websocket_connections_total", "Accepted connections", ["endpoint"])
WS_DISCONNECTS = Counter(PREFIX + "websocket_disconnects_total", "Closed accepted connections", ["endpoint"])
WS_MESSAGES = Counter(
    PREFIX + "websocket_messages_total", "Received or successfully sent messages", ["endpoint", "direction", "type"]
)
BROADCAST_DURATION = Histogram(
    PREFIX + "spot_broadcast_duration_seconds",
    "Complete fan-out to both protocols including recipient eviction",
    buckets=BACKGROUND_BUCKETS,
)
BROADCAST_FAILURES = Counter(PREFIX + "spot_broadcast_send_failures_total", "Failed recipient sends including timeouts")
FEATURES = Counter(PREFIX + "feature_requests_total", "Feature requests dispatched", ["feature"])
HISTORY_RECORDS = Counter(PREFIX + "history_records_total", "Returned history records or samples", ["kind"])
BACKGROUND_RUNS = Counter(
    PREFIX + "background_runs_total", "Completed work runs; excludes idle reads and cancellation", ["task", "outcome"]
)
BACKGROUND_DURATION = Histogram(
    PREFIX + "background_run_duration_seconds",
    "Work run duration; excludes idle reads and cancellation",
    ["task", "outcome"],
    buckets=BACKGROUND_BUCKETS,
)
BACKGROUND_SUCCESS = Gauge(
    PREFIX + "background_last_success_timestamp_seconds", "Last completed successful work run", ["task"]
)

HTTP_FEATURES = {
    "/history": "spot_history",
    "/propagation/history": "propagation_history",
    "/voacap": "voacap",
    "/catserver/releases/latest": "release_check",
    "/catserver/releases/{platform}/{architecture}": "release_check",
    "/catserver/latest": "release_check",
    "/catserver/artifacts/{name}": "release_download",
    "/catserver/download": "release_download",
    "/catserver/download/{platform}/{architecture}": "release_download",
}


def background_run(task, outcome, started):
    BACKGROUND_RUNS.labels(task, outcome).inc()
    BACKGROUND_DURATION.labels(task, outcome).observe(time.perf_counter() - started)
    if outcome == "success":
        BACKGROUND_SUCCESS.labels(task).set(time.time())


def message_type(raw):
    try:
        message = json.loads(raw)
    except (ValueError, TypeError, UnicodeDecodeError):
        return "malformed"
    return message_kind(message)


def message_kind(message):
    if not isinstance(message, dict):
        return "malformed"
    kind = message.get("type")
    if isinstance(kind, str) and kind in {
        "spots",
        "submit",
        "radio",
        "missing",
        "history",
        "error",
        "initial",
        "update",
    }:
        return kind
    return "unknown"


def client_version(message, field):
    if field not in message:
        return "not_reported"
    value = message[field]
    if value is None:
        return "development" if field == "ui_version" else "none"
    if not isinstance(value, str) or len(value) > 64:
        return "invalid"
    if field == "ui_version":
        if UI_SHA.fullmatch(value):
            return value.lower()
        return value if UI_TAG.fullmatch(value) else "invalid"
    return value if CAT_TAG.fullmatch(value) else "invalid"


def client_version_pair(message):
    pair = (client_version(message, "ui_version"), client_version(message, "catserver_version"))
    # Keep admission atomic when multiple ASGI threads share the registry.
    with CLIENT_VERSION_PAIR_LOCK:
        if pair in CLIENT_VERSION_PAIRS:
            return pair
        if len(CLIENT_VERSION_PAIRS) >= 100:
            return ("other", "other")
        CLIENT_VERSION_PAIRS.add(pair)
    return pair


@dataclass
class Connection:
    endpoint: str
    active: bool = True
    client_versions: tuple[str, str] | None = None

    def report_client_versions(self, message):
        if not self.active:
            return
        pair = client_version_pair(message)
        if pair == self.client_versions:
            return
        if self.client_versions is not None:
            CLIENT_VERSION_ACTIVE.labels(*self.client_versions).dec()
        self.client_versions = pair
        CLIENT_VERSION_ACTIVE.labels(*pair).inc()
        CLIENT_VERSION_REPORTS.labels(*pair).inc()

    def close(self):
        if self.active:
            self.active = False
            if self.client_versions is not None:
                CLIENT_VERSION_ACTIVE.labels(*self.client_versions).dec()
            WS_ACTIVE.labels(self.endpoint).dec()
            WS_DISCONNECTS.labels(self.endpoint).inc()


class MetricsMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            started = time.perf_counter()
            status = 500

            async def http_send(message):
                nonlocal status
                if message["type"] == "http.response.start":
                    status = message["status"]
                await send(message)

            try:
                await self.app(scope, receive, http_send)
            finally:
                route = getattr(scope.get("route"), "path", "unmatched")
                method = scope["method"]
                if method not in {"GET", "HEAD", "POST", "PUT", "DELETE", "CONNECT", "OPTIONS", "TRACE", "PATCH"}:
                    method = "other"
                HTTP_REQUESTS.labels(method, route, str(status)).inc()
                HTTP_DURATION.labels(method, route).observe(time.perf_counter() - started)
                if method == "GET" and route in HTTP_FEATURES:
                    FEATURES.labels(HTTP_FEATURES[route]).inc()
            return
        if scope["type"] != "websocket":
            await self.app(scope, receive, send)
            return

        async def ws_send(message):
            await send(message)
            if message["type"] == "websocket.accept":
                endpoint = getattr(scope.get("route"), "path", "unmatched")
                scope["metrics_connection"] = Connection(endpoint)
                WS_ACTIVE.labels(endpoint).inc()
                WS_TOTAL.labels(endpoint).inc()
            elif message["type"] == "websocket.close":
                if connection := scope.get("metrics_connection"):
                    connection.close()
            elif message["type"] == "websocket.send":
                if connection := scope.get("metrics_connection"):
                    # Do not parse serialized spot batches again.
                    kind = scope.get("metrics_outgoing_type", "unknown")
                    WS_MESSAGES.labels(connection.endpoint, "sent", kind).inc()

        def count_message(message, direction):
            if connection := scope.get("metrics_connection"):
                kind = message_type(message.get("text") or message.get("bytes"))
                WS_MESSAGES.labels(connection.endpoint, direction, kind).inc()

        async def ws_receive():
            message = await receive()
            if message["type"] == "websocket.receive":
                count_message(message, "received")
            elif message["type"] == "websocket.disconnect":
                if connection := scope.get("metrics_connection"):
                    connection.close()
            return message

        try:
            await self.app(scope, ws_receive, ws_send)
        finally:
            if connection := scope.get("metrics_connection"):
                connection.close()
