import re
from collections.abc import Mapping
from typing import Any

import sentry_sdk

from .settings import SentrySettings

SENSITIVE_KEY_PARTS = (
    "authorization",
    "callsign",
    "cookie",
    "credential",
    "locator",
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
REDACTED = "[Filtered]"
enabled = False


def is_sensitive_key(key: object) -> bool:
    return any(part in str(key).lower() for part in SENSITIVE_KEY_PARTS)


def scrub_text(value: str) -> str:
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
    event.pop("breadcrumbs", None)
    event.pop("contexts", None)
    event.pop("request", None)
    event.pop("user", None)
    return scrub_value(event)


def initialize_sentry(settings: SentrySettings, service: str):
    global enabled
    enabled = bool(settings.sentry_dsn)
    if not settings.sentry_dsn:
        return None

    return sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=settings.sentry_release,
        send_default_pii=False,
        include_local_variables=False,
        max_breadcrumbs=0,
        before_send=scrub_event,
        initial_scope={"tags": {"service": service}},
    )


def capture_exception(error: BaseException) -> None:
    if enabled:
        sentry_sdk.capture_exception(error)
