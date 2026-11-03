import hashlib
import json
from collections.abc import Callable

from loguru import logger
from redis.exceptions import WatchError

from .adapters import SERVICES, SOURCES, identity, validate_source
from .metrics import Metrics
from .samples import SampleSink

WINDOW = 60


def empty_state() -> dict:
    return {
        "version": 1,
        "feeds": {s: {"up": False, "generation": 0, "since": 0, "success": None, "spot": None} for s in SOURCES},
        "windows": {},
        "pending_windows": 0,
        "oldest_deadline": 0,
        "outcomes": {},
        "skipped": {},
        "samples": {},
        "last_event_id": "0-0",
    }


def increment(state: dict, metric: str, service: str, result: str):
    key = f"{service}|{result}"
    state[metric][key] = state[metric].get(key, 0) + 1


def stream_id(value: str) -> tuple[int, int]:
    return tuple(map(int, value.split("-")))


class Matcher:
    def __init__(
        self, redis, metrics: Metrics, sink: SampleSink, *, max_windows: int = 10000,
        max_samples: int = 1000, sample_max_bytes: int = 4096, stale_after: float = 120,
    ):
        self.redis = redis
        self.metrics = metrics
        self.sink = sink
        self.max_windows = max_windows
        self.max_samples = max_samples
        self.sample_max_bytes = sample_max_bytes
        self.stale_after = stale_after

    def eligibility(self, state: dict, service: str, now: float) -> str | None:
        for source in ("holy", service):
            feed = state["feeds"][source]
            if not feed["up"]:
                return "feed_down"
            if now - feed["since"] < WINDOW:
                return "warmup"
            if feed["success"] is None or now - feed["success"] > self.stale_after:
                return "stale"
        return None

    async def change(self, now: float, mutate: Callable, *, window_key: str | None = None, load_due=False):
        # WATCH keeps stream replay and finalization atomic without a lease expiry race.
        while True:
            async with self.redis.pipeline(transaction=True) as pipe:
                try:
                    await pipe.watch("coverage:state", "coverage:windows", "coverage:deadlines")
                    raw = await pipe.get("coverage:state")
                    reset = raw is None
                    try:
                        state = json.loads(raw) if raw else empty_state()
                        if state["version"] != 1:
                            raise ValueError("Unknown coverage state version")
                        for key in empty_state():
                            if key not in state:
                                raise ValueError("Incomplete coverage state")
                    except (ValueError, TypeError, KeyError):
                        logger.error("Coverage state is not recoverable; start a new health generation")
                        state = empty_state()
                        reset = True
                        for service in SERVICES:
                            increment(state, "skipped", service, "unrecoverable")
                    keys = set(await pipe.zrangebyscore("coverage:deadlines", "-inf", now, start=0, num=100)) if load_due else set()
                    if window_key is not None:
                        keys.add(window_key)
                    if reset:
                        keys.clear()
                    state["windows"] = {}
                    for key in keys:
                        value = await pipe.hget("coverage:windows", key)
                        if value:
                            state["windows"][key] = json.loads(value)
                    before = {key: json.dumps(value, allow_nan=False) for key, value in state["windows"].items()}
                    count = 0 if reset else await pipe.zcard("coverage:deadlines")
                    state["pending_windows"] = count
                    oldest = await pipe.zrange("coverage:deadlines", 0, 0, withscores=True)
                    state["oldest_deadline"] = oldest[0][1] if oldest else now
                    mutate(state)
                    removed = before.keys() - state["windows"].keys()
                    state["pending_windows"] = count + len(state["windows"]) - len(before)
                    pipe.multi()
                    if reset:
                        pipe.delete("coverage:windows", "coverage:deadlines")
                    if removed:
                        pipe.hdel("coverage:windows", *removed)
                        pipe.zrem("coverage:deadlines", *removed)
                    for key, value in state["windows"].items():
                        encoded = json.dumps(value, allow_nan=False)
                        if before.get(key) != encoded:
                            pipe.hset("coverage:windows", key, encoded)
                            pipe.zadd("coverage:deadlines", {key: value["deadline"]})
                    pipe.set("coverage:state", json.dumps({**state, "windows": {}}, allow_nan=False))
                    await pipe.execute()
                    self.metrics.sync(state, now, self.eligibility)
                    return state
                except WatchError:
                    continue

    async def health(self, source: str, up: bool, now: float, *, saturated=False, recoverable=True):
        validate_source(source)
        if saturated:
            self.metrics.saturated.labels(source).inc()

        def update(state):
            feed = state["feeds"][source]
            good = up and not saturated and recoverable
            stale = feed["success"] is not None and now - feed["success"] > self.stale_after
            if not good or not feed["up"] or stale:
                feed["generation"] += 1
                feed["since"] = now
            feed["up"] = good
            if good:
                feed["success"] = now

        await self.change(now, update)

    async def restart(self, now: float):
        def update(state):
            for feed in state["feeds"].values():
                feed["up"] = False
                feed["generation"] += 1
                feed["since"] = now
        await self.change(now, update)

    def finish(self, state: dict, now: float):
        for key, window in list(state["windows"].items()):
            if now < window["deadline"]:
                continue
            for service in SERVICES:
                holy = "holy" in window["sources"]
                other = service in window["sources"]
                if not holy and not other:
                    continue
                pair = window["pairs"][service]
                generations = [state["feeds"][s]["generation"] for s in ("holy", service)]
                reason = pair["reason"] or self.eligibility(state, service, now)
                if generations != pair["generations"]:
                    reason = "generation"
                if reason:
                    increment(state, "skipped", service, reason)
                    continue
                result = "matched" if holy and other else "holy_only" if holy else "service_only"
                increment(state, "outcomes", service, result)
                if result != "matched":
                    if len(state["samples"]) < self.max_samples:
                        sample_id = f"{key}:{window['opened']}:{service}"
                        state["samples"][sample_id] = {
                            "service": service, "result": result, "opened": window["opened"],
                            "finalized": now, "spot": window["spot"],
                        }
                    else:
                        increment(state, "skipped", service, "sample_limit")
            del state["windows"][key]
            state["pending_windows"] -= 1

    async def observe(self, source: str, spot: dict, now: float, *, event_id: str | None = None):
        validate_source(source)
        key = hashlib.sha256(identity(spot).encode()).hexdigest()
        encoded = json.dumps(spot, allow_nan=False)
        if len(encoded.encode()) > self.sample_max_bytes:
            raise ValueError("Spot exceeds the sample size limit")
        if event_id is not None:
            if source != "holy":
                raise ValueError("Stream IDs are for Holy observations only")
            stream_id(event_id)

        def update(state):
            if event_id is not None:
                if stream_id(event_id) <= stream_id(state["last_event_id"]):
                    return
                state["last_event_id"] = event_id
            self.finish(state, now)
            state["feeds"][source]["spot"] = now
            if key not in state["windows"]:
                if state["pending_windows"] >= self.max_windows:
                    for feed in state["feeds"].values():
                        feed["up"] = False
                        feed["generation"] += 1
                    for service in SERVICES if source == "holy" else (source,):
                        increment(state, "skipped", service, "capacity")
                    return
                state["windows"][key] = {
                    "opened": now, "deadline": now + WINDOW, "sources": [], "spot": json.loads(encoded),
                    "pairs": {
                        service: {
                            "generations": [state["feeds"][s]["generation"] for s in ("holy", service)],
                            "reason": self.eligibility(state, service, now),
                        } for service in SERVICES
                    },
                }
            if source not in state["windows"][key]["sources"]:
                state["windows"][key]["sources"].append(source)

        state = await self.change(now, update, window_key=key, load_due=True)
        await self.flush_samples(now, state)

    async def finalize(self, now: float):
        state = await self.change(now, lambda state: self.finish(state, now), load_due=True)
        await self.flush_samples(now, state)

    async def flush_samples(self, now: float, state: dict | None = None):
        if state is None:
            state = await self.change(now, lambda state: None)
        for sample_id, sample in state["samples"].items():
            await self.sink.put(sample_id, sample)
            await self.change(now, lambda current: current["samples"].pop(sample_id, None))
