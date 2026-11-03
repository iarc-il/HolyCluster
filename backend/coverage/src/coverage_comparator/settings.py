from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import SettingsConfigDict
from shared.settings import LogSettings, PostgresSettings, SentrySettings, ValkeySettings

from .adapters import SERVICES


class Settings(PostgresSettings, ValkeySettings, LogSettings, SentrySettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    coverage_enabled: bool = True
    coverage_services: tuple[str, ...] = ()
    coverage_metrics_port: int = Field(default=9102, ge=1, le=65535)
    coverage_identity_window_seconds: Literal[60] = 60
    coverage_max_windows: int = Field(default=10000, ge=1, le=100000)
    coverage_max_samples: int = Field(default=1000, ge=0, le=10000)
    coverage_sample_max_bytes: int = Field(default=4096, ge=256, le=65536)
    coverage_max_snapshot_spots: int = Field(default=10000, ge=1, le=100000)
    coverage_stale_after_seconds: int = Field(default=120, ge=60)

    @field_validator("coverage_services")
    @classmethod
    def known_services(cls, value):
        if len(set(value)) != len(value) or any(service not in SERVICES for service in value):
            raise ValueError("Coverage services must be unique known service names")
        return value
