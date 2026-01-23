from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from shared.settings import PostgresSettings, QrzSettings, ValkeySettings


class ApiSettings(PostgresSettings, ValkeySettings, QrzSettings, BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    ui_dist_path: Path = Field(..., description="Path to UI distribution files")
    catserver_msi_dir: Path = Field(..., description="Path to CATServer MSI directory")
    spots_log_path: str = Field(..., description="Path to spots log file")


settings = ApiSettings()
