import re
import time
from contextlib import contextmanager
from dataclasses import dataclass

from aiohttp import web
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest

JSON_SOURCES = ("pota", "sota", "wwff")
TELNET_SOURCE_PATTERN = re.compile(r"[A-Z][A-Z0-9_-]{0,31}", re.ASCII)


def validate_telnet_source(source: str):
    if not isinstance(source, str) or TELNET_SOURCE_PATTERN.fullmatch(source) is None:
        raise ValueError("Telnet source name must contain 1-32 uppercase ASCII letters, digits, underscores or hyphens")


@dataclass(frozen=True)
class SpotEnvelope:
    source: str
    spot: dict

    def __post_init__(self):
        if self.source not in JSON_SOURCES:
            validate_telnet_source(self.source)


class CollectorMetrics:
    def __init__(self):
        self.registry = CollectorRegistry()
        prefix = "holycluster_collector_"

        def metric(kind, name, help_text, labels=()):
            return kind(prefix + name, help_text, labels, registry=self.registry)

        self.source_up = metric(Gauge, "source_up", "Source connection or most recent JSON response health", ["source"])
        for source in JSON_SOURCES:
            self.source_up.labels(source).set(0)
        self.source_last_spot = metric(
            Gauge,
            "source_last_spot_timestamp_seconds",
            "Last successfully parsed spot before deduplication",
            ["source"],
        )
        self.polls = metric(Counter, "polls_total", "JSON fetch outcomes", ["source", "result"])
        self.poll_success = metric(Gauge, "poll_last_success_timestamp_seconds", "Last decoded JSON list", ["source"])
        self.spots = metric(Counter, "spots_total", "Spot branch outcomes", ["source", "stage", "result"])
        self.processing = metric(Histogram, "processing_duration_seconds", "Processing time", ["source", "stage"])
        self.operations = metric(
            Counter, "persistence_operations_total", "Persistence operation outcomes", ["operation", "result"]
        )
        self.refreshes = metric(Counter, "refresh_total", "Reference refresh outcomes", ["dataset", "result"])
        self.refresh_duration = metric(Histogram, "refresh_duration_seconds", "Reference refresh time", ["dataset"])
        self.refresh_success = metric(
            Gauge, "refresh_last_success_timestamp_seconds", "Last reference refresh", ["dataset"]
        )
        self.reconnects = metric(
            Counter, "telnet_reconnect_attempts_total", "Connection attempts after initial attempt", ["source"]
        )
        self.connections = 0
        self.outage_start = None
        self.outage = metric(Gauge, "telnet_outage_duration_seconds", "Current aggregate zero-connection outage")
        self.outage.set_function(lambda: time.monotonic() - self.outage_start if self.outage_start is not None else 0)
        self.outages = metric(Histogram, "telnet_outage_seconds", "Completed aggregate zero-connection outages")
        self.depth = metric(Gauge, "queue_depth", "Spots waiting for processing")
        self.capacity = metric(Gauge, "queue_capacity", "Maximum queued spots")

    def bind_queue(self, queue):
        self.depth.set_function(queue.qsize)
        self.capacity.set(queue.maxsize)

    def start_telnet(self):
        self.outage_start = time.monotonic()

    def register_telnet_source(self, source):
        validate_telnet_source(source)
        self.source_up.labels(source).set(0)
        self.reconnects.labels(source)

    def connection(self, source, connected):
        self.connections += 1 if connected else -1
        self.source_up.labels(source).set(connected)
        if self.connections > 0 and self.outage_start is not None:
            self.outages.observe(time.monotonic() - self.outage_start)
            self.outage_start = None
        elif self.connections == 0 and self.outage_start is None:
            self.outage_start = time.monotonic()

    @contextmanager
    def operation(self, operation):
        self.operations.labels(operation, "attempt").inc()
        try:
            yield
        except Exception:
            self.operations.labels(operation, "error").inc()
            raise
        else:
            self.operations.labels(operation, "success").inc()

    @contextmanager
    def refresh(self, dataset):
        self.refreshes.labels(dataset, "attempt").inc()
        with self.refresh_duration.labels(dataset).time():
            try:
                yield
            except Exception:
                self.refreshes.labels(dataset, "error").inc()
                raise
            else:
                self.refreshes.labels(dataset, "success").inc()
                self.refresh_success.labels(dataset).set_to_current_time()


metrics = CollectorMetrics()


async def start_metrics_server(port, collector_metrics=None):
    collector_metrics = collector_metrics or metrics

    async def expose(request):
        return web.Response(
            body=generate_latest(collector_metrics.registry), headers={"Content-Type": CONTENT_TYPE_LATEST}
        )

    app = web.Application()
    app.router.add_get("/metrics", expose)
    runner = web.AppRunner(app)
    await runner.setup()
    try:
        await web.TCPSite(runner, "0.0.0.0", port).start()
    except BaseException:
        await runner.cleanup()
        raise
    return runner
