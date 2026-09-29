import time

import sentry_sdk

from .settings import SentrySettings

enabled = False
reported_errors: dict[tuple[str, str], float] = {}
TRANSIENT_ERROR_INTERVAL_SECONDS = 300


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
    )
    sentry_sdk.set_tag("service", service)
    return client


def capture_exception(error: BaseException, operation: str | None = None) -> None:
    if enabled:
        if operation is None:
            sentry_sdk.capture_exception(error)
            return

        now = time.monotonic()
        error_type = error.__class__.__name__
        error_key = (operation, error_type)
        previous = reported_errors.get(error_key)
        if previous is not None and now - previous < TRANSIENT_ERROR_INTERVAL_SECONDS:
            return
        reported_errors[error_key] = now

        with sentry_sdk.new_scope() as scope:
            scope.set_tag("operation", operation)
            scope.fingerprint = [operation, error_type]
            sentry_sdk.capture_exception(error)
