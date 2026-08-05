from shared.settings import SentrySettings
from shared.telemetry import REDACTED, capture_exception, initialize_sentry, scrub_event


def test_initialize_sentry_is_disabled_without_dsn(monkeypatch):
    called = False

    def sentry_init(**kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr("shared.telemetry.sentry_sdk.init", sentry_init)
    monkeypatch.setattr("shared.telemetry.sentry_sdk.capture_exception", sentry_init)

    assert initialize_sentry(SentrySettings(), "api") is None
    capture_exception(ValueError("not reported"))
    assert not called


def test_initialize_sentry_sets_service_and_release_metadata(monkeypatch):
    captured = {}

    def sentry_init(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr("shared.telemetry.sentry_sdk.init", sentry_init)

    initialize_sentry(
        SentrySettings(sentry_dsn="https://key@example.invalid/1", sentry_environment="staging", sentry_release="v1"),
        "collector",
    )

    assert captured["environment"] == "staging"
    assert captured["release"] == "v1"
    assert captured["initial_scope"] == {"tags": {"service": "collector"}}


def test_scrub_event_removes_request_data_and_sensitive_values():
    event = {
        "request": {"data": "raw spot", "query_string": "callsign=K1ABC"},
        "breadcrumbs": [{"message": "radio configuration"}],
        "contexts": {"radio": {"frequency": "14074"}},
        "extra": {
            "raw_spot": {"dx_callsign": "K1ABC"},
            "message": "Failed for K1ABC at FN31 with ?callsign=K1ABC",
        },
        "exception": {"values": [{"value": "K1ABC at FN31"}]},
    }

    scrubbed = scrub_event(event, {})

    assert "request" not in scrubbed
    assert "breadcrumbs" not in scrubbed
    assert "contexts" not in scrubbed
    assert scrubbed["extra"]["raw_spot"] == REDACTED
    assert scrubbed["extra"]["message"] == f"Failed for {REDACTED} at {REDACTED} with "
    assert scrubbed["exception"]["values"][0]["value"] == REDACTED
