from pathlib import Path

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class PostgresSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    postgres_user: str = Field(..., description="PostgreSQL username")
    postgres_password: str = Field(..., description="PostgreSQL password")
    postgres_db_name: str = Field(default="holy_cluster", description="PostgreSQL database name")

    postgres_host: str = Field(..., description="PostgreSQL host in Docker environment")
    postgres_port: str = Field(..., description="PostgreSQL port in Docker environment")
    postgres_host_local: str = Field(..., description="PostgreSQL host in local environment")
    postgres_port_local: str = Field(..., description="PostgreSQL port in local environment")

    @property
    def _in_docker(self) -> bool:
        return Path("/.dockerenv").exists()

    @computed_field
    @property
    def postgres_effective_host(self) -> str:
        return self.postgres_host if self._in_docker else self.postgres_host_local

    @computed_field
    @property
    def postgres_effective_port(self) -> str:
        return self.postgres_port if self._in_docker else self.postgres_port_local

    @computed_field
    @property
    def general_db_url(self) -> str:
        return f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}@{self.postgres_effective_host}:{self.postgres_effective_port}"

    @computed_field
    @property
    def db_url(self) -> str:
        return f"{self.general_db_url}/{self.postgres_db_name}"


class ValkeySettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    valkey_db: str = Field(default="0", description="Valkey database number")
    valkey_geo_expiration: int = Field(default=3600, description="Valkey geo data expiration time in seconds")

    valkey_host: str = Field(..., description="Valkey host in Docker environment")
    valkey_port: int = Field(..., description="Valkey port in Docker environment")
    valkey_host_local: str = Field(..., description="Valkey host in local environment")
    valkey_port_local: int = Field(..., description="Valkey port in local environment")

    @property
    def _in_docker(self) -> bool:
        return Path("/.dockerenv").exists()

    @computed_field
    @property
    def valkey_effective_host(self) -> str:
        return self.valkey_host if self._in_docker else self.valkey_host_local

    @computed_field
    @property
    def valkey_effective_port(self) -> int:
        return self.valkey_port if self._in_docker else self.valkey_port_local


class QrzSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    qrz_user: str = Field(..., description="QRZ.com username")
    qrz_password: str = Field(..., description="QRZ.com password")
    qrz_api_key: str = Field(..., description="QRZ.com API key")
    qrz_session_key_refresh: int = Field(default=3600, description="QRZ session key refresh interval in seconds")
