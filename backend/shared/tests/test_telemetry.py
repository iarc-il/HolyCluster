import pytest
from pydantic import ValidationError

from shared.settings import SentrySettings
from shared import telemetry
from shared.telemetry import capture_exception, initialize_sentry


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
    monkeypatch.setattr(
        "shared.telemetry.sentry_sdk.set_tag",
        lambda key, value: captured.setdefault("tags", {}).update({key: value}),
    )

    initialize_sentry(
        SentrySettings(sentry_dsn="https://key@example.invalid/1", sentry_environment="dev", sentry_release="v1"),
        "collector",
    )

    assert captured["environment"] == "dev"
    assert captured["release"] == "v1"
    assert captured["tags"] == {"service": "collector"}
    assert "before_send" not in captured


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
