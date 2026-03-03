from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from shared.settings import LogSettings, PostgresSettings, QrzSettings, ValkeySettings


class CollectorsSettings(PostgresSettings, ValkeySettings, QrzSettings, LogSettings, BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    debug: bool = Field(default=False, description="Enable debug mode")
    postgres_db_retention_days: int = Field(default=14, description="PostgreSQL database retention period in days")
    valkey_spot_expiration: int = Field(default=60, description="Valkey spot expiration time in seconds")
    username_for_telnet_clusters: str = Field(..., description="Username for telnet cluster connections")


settings = CollectorsSettings()
