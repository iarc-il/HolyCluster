from prometheus_client import CollectorRegistry, Counter, Gauge

from .adapters import SERVICES, SOURCES

REASONS = ("feed_down", "warmup", "stale", "generation", "saturated", "unrecoverable", "capacity", "sample_limit")
RESULTS = ("matched", "holy_only", "service_only")
PREFIX = "holycluster_coverage_"


class Metrics:
    def __init__(self, registry: CollectorRegistry):
        self.outcomes = Counter(PREFIX + "outcomes_total", "Final pairwise outcomes", ("service", "result"), registry=registry)
        self.skipped = Counter(PREFIX + "skipped_total", "Skipped comparisons", ("service", "reason"), registry=registry)
        self.feed_up = Gauge(PREFIX + "feed_up", "Feed transport is healthy", ("service",), registry=registry)
        self.eligible = Gauge(PREFIX + "comparison_eligible", "Pair can be compared", ("service",), registry=registry)
        self.last_success = Gauge(
            PREFIX + "feed_last_success_timestamp_seconds", "Last successful feed read", ("service",), registry=registry
        )
        self.last_spot = Gauge(
            PREFIX + "feed_last_spot_timestamp_seconds", "Last spot receipt", ("service",), registry=registry
        )
        self.parse_errors = Counter(PREFIX + "parse_errors_total", "Invalid records", ("service",), registry=registry)
        self.reconnects = Counter(PREFIX + "reconnects_total", "Feed retry attempts", ("service",), registry=registry)
        self.saturated = Counter(PREFIX + "snapshot_saturated_total", "Incomplete snapshots", ("service",), registry=registry)
        self.pending = Gauge(PREFIX + "pending_windows", "Open identity windows", registry=registry)
        self.lag = Gauge(PREFIX + "finalization_lag_seconds", "Oldest due window lag", registry=registry)
        self.window = Gauge(PREFIX + "identity_window_seconds", "Fixed identity interval", registry=registry)
        self.window.set(60)
        self._totals: dict[tuple[str, str], int] = {}
        for service in SERVICES:
            self.eligible.labels(service).set(0)
            for result in RESULTS:
                self.outcomes.labels(service, result)
            for reason in REASONS:
                self.skipped.labels(service, reason)
        for source in SOURCES:
            for metric in (self.feed_up, self.last_success, self.last_spot):
                metric.labels(source).set(0)
            for metric in (self.parse_errors, self.reconnects, self.saturated):
                metric.labels(source)

    def sync(self, state: dict, now: float, eligibility):
        for name in ("outcomes", "skipped"):
            for labels, value in state[name].items():
                key = (name, labels)
                previous = self._totals.get(key, 0)
                getattr(self, name).labels(*labels.split("|")).inc(max(0, value - previous))
                self._totals[key] = value
        for source, feed in state["feeds"].items():
            self.feed_up.labels(source).set(feed["up"])
            self.last_success.labels(source).set(feed["success"] or 0)
            self.last_spot.labels(source).set(feed["spot"] or 0)
        for service in SERVICES:
            self.eligible.labels(service).set(eligibility(state, service, now) is None)
        self.pending.set(len(state["windows"]))
        self.lag.set(max([0, *(now - w["deadline"] for w in state["windows"].values())]))
