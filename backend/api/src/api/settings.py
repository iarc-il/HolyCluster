import os
from pathlib import Path

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict
from shared.settings import LogSettings, PostgresSettings, QrzSettings, ValkeySettings


class ApiSettings(PostgresSettings, ValkeySettings, QrzSettings, LogSettings, BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    ui_dist_path: Path = Field(..., description="Path to UI distribution files")
    catserver_msi_dir: Path = Field(..., description="Path to CATServer MSI directory")

    @computed_field
    @property
    def spots_log_path(self) -> str:
        return os.path.join(self.log_dir, "api", "spots")


settings = ApiSettings()
