import re
import time
from collections.abc import Mapping
from copy import deepcopy
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import sentry_sdk

from .settings import SentrySettings

SENSITIVE_KEY_PARTS = (
    "authorization",
    "callsign",
    "cookie",
    "credential",
    "locator",
    "latitude",
    "longitude",
    "password",
    "raw_spot",
    "radio",
    "secret",
    "spotter",
    "token",
)
CALLSIGN_PATTERN = re.compile(r"\b[A-Z]{1,3}\d[A-Z0-9/]{0,7}\b", re.IGNORECASE)
LOCATOR_PATTERN = re.compile(r"\b[A-R]{2}\d{2}(?:[A-X]{2}){0,2}\b", re.IGNORECASE)
URL_QUERY_PATTERN = re.compile(r"\?[^\s]+")
URL_PATTERN = re.compile(r"https?://[^\s'\"]+", re.IGNORECASE)
REDACTED = "[Filtered]"
enabled = False
reported_errors: dict[tuple[str, str], float] = {}
TRANSIENT_ERROR_INTERVAL_SECONDS = 300


def is_sensitive_key(key: object) -> bool:
    return any(part in str(key).lower() for part in SENSITIVE_KEY_PARTS)


def scrub_text(value: str) -> str:
    def scrub_url(match: re.Match) -> str:
        url = urlsplit(match.group())
        netloc = url.hostname or ""
        if url.port:
            netloc = f"{netloc}:{url.port}"
        return urlunsplit((url.scheme, netloc, url.path, "", ""))

    value = URL_PATTERN.sub(scrub_url, value)
    value = URL_QUERY_PATTERN.sub("", value)
    value = CALLSIGN_PATTERN.sub(REDACTED, value)
    return LOCATOR_PATTERN.sub(REDACTED, value)


def scrub_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: REDACTED if is_sensitive_key(key) else scrub_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [scrub_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(scrub_value(item) for item in value)
    if isinstance(value, str):
        return scrub_text(value)
    return value


def scrub_event(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any]:
    scrubbed = deepcopy(event)
    scrubbed.pop("breadcrumbs", None)
    scrubbed.pop("contexts", None)
    scrubbed.pop("request", None)
    scrubbed.pop("user", None)
    scrubbed = scrub_value(scrubbed)
    for value in scrubbed.get("exception", {}).get("values", []):
        value["value"] = REDACTED
        for frame in value.get("stacktrace", {}).get("frames", []):
            frame.pop("vars", None)
    return scrubbed


def initialize_sentry(settings: SentrySettings, service: str):
    global enabled
    enabled = bool(settings.sentry_dsn)
    if not settings.sentry_dsn:
        return None

    client = sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=settings.sentry_release,
        send_default_pii=False,
        include_local_variables=False,
        max_breadcrumbs=0,
        before_send=scrub_event,
    )
    sentry_sdk.set_tag("service", service)
    return client


def capture_exception(error: BaseException, operation: str | None = None) -> None:
    if enabled:
        if operation is not None:
            now = time.monotonic()
            error_key = (operation, error.__class__.__name__)
            previous = reported_errors.get(error_key)
            if previous is not None and now - previous < TRANSIENT_ERROR_INTERVAL_SECONDS:
                return
            reported_errors[error_key] = now
        sentry_sdk.capture_exception(error)
