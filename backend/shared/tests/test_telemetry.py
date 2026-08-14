import pytest
from pydantic import ValidationError

from shared.settings import SentrySettings
from shared import telemetry
from shared.telemetry import REDACTED, capture_exception, initialize_sentry, scrub_event


def test_initialize_sentry_is_disabled_without_dsn(monkeypatch):
    called = False

    def sentry_init(**kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr("shared.telemetry.sentry_sdk.init", sentry_init)
    monkeypatch.setattr("shared.telemetry.sentry_sdk.capture_exception", sentry_init)

    assert initialize_sentry(SentrySettings(sentry_environment="dev", sentry_release="test"), "api") is None
    capture_exception(ValueError("not reported"))
    assert not called


def test_sentry_metadata_is_required(monkeypatch):
    monkeypatch.delenv("SENTRY_ENVIRONMENT", raising=False)
    monkeypatch.delenv("SENTRY_RELEASE", raising=False)

    with pytest.raises(ValidationError):
        SentrySettings(_env_file=None)


def test_initialize_sentry_sets_service_and_release_metadata(monkeypatch):
    captured = {}

    def sentry_init(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr("shared.telemetry.sentry_sdk.init", sentry_init)

    initialize_sentry(
        SentrySettings(sentry_dsn="https://key@example.invalid/1", sentry_environment="dev", sentry_release="v1"),
        "collector",
    )

    assert captured["environment"] == "dev"
    assert captured["release"] == "v1"
    assert captured["initial_scope"] == {"tags": {"service": "collector"}}


def test_scrub_event_removes_sensitive_values_without_mutating_the_event():
    event = {
        "request": {"data": "raw spot", "query_string": "callsign=K1ABC"},
        "breadcrumbs": [{"message": "radio configuration"}],
        "contexts": {"radio": {"frequency": "14074"}},
        "extra": {
            "raw_spot": {"dx_callsign": "K1ABC"},
            "nested": [{"message": "Failed for K1ABC at FN31"}],
            "url": "https://user:password@example.invalid/K1ABC?token=secret",
        },
        "logentry": {"message": "Failed for K1ABC at FN31"},
        "exception": {
            "values": [
                {"value": "K1ABC at FN31", "stacktrace": {"frames": [{"vars": {"locator": "FN31"}}]}},
                {"value": "Caused by K2XYZ"},
            ]
        },
    }

    scrubbed = scrub_event(event, {})

    assert event["request"]["query_string"] == "callsign=K1ABC"
    assert event["exception"]["values"][0]["stacktrace"]["frames"][0]["vars"] == {"locator": "FN31"}
    assert "request" not in scrubbed
    assert "breadcrumbs" not in scrubbed
    assert "contexts" not in scrubbed
    assert scrubbed["extra"]["raw_spot"] == REDACTED
    assert scrubbed["extra"]["nested"][0]["message"] == f"Failed for {REDACTED} at {REDACTED}"
    assert scrubbed["extra"]["url"] == f"https://example.invalid/{REDACTED}"
    assert scrubbed["logentry"]["message"] == f"Failed for {REDACTED} at {REDACTED}"
    assert scrubbed["exception"]["values"][0]["value"] == REDACTED
    assert scrubbed["exception"]["values"][1]["value"] == REDACTED
    assert "vars" not in scrubbed["exception"]["values"][0]["stacktrace"]["frames"][0]


def test_capture_exception_rate_limits_transient_operations(monkeypatch):
    reported = []
    monkeypatch.setattr(telemetry, "enabled", True)
    monkeypatch.setattr(telemetry, "reported_errors", {})
    monkeypatch.setattr("shared.telemetry.time.monotonic", lambda: 1)
    monkeypatch.setattr("shared.telemetry.sentry_sdk.capture_exception", reported.append)

    capture_exception(RuntimeError("failed"), operation="collector.poll.pota")
    capture_exception(RuntimeError("failed"), operation="collector.poll.pota")
    capture_exception(RuntimeError("failed"), operation="collector.poll.sota")

    assert len(reported) == 2
