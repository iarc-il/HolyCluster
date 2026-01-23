from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from shared.settings import PostgresSettings, QrzSettings, ValkeySettings


class CollectorsSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    debug: bool = Field(default=False, description="Enable debug mode")
    postgres_db_retention_days: int = Field(
        default=14, description="PostgreSQL database retention period in days"
    )
    valkey_spot_expiration: int = Field(
        default=60, description="Valkey spot expiration time in seconds"
    )
    username_for_telnet_clusters: str = Field(
        ..., description="Username for telnet cluster connections"
    )


# Instantiate settings singletons
_postgres = PostgresSettings()
_valkey = ValkeySettings()
_qrz = QrzSettings()
_collectors = CollectorsSettings()

# PostgreSQL exports (backward compatibility)
POSTGRES_USER = _postgres.postgres_user
POSTGRES_PASSWORD = _postgres.postgres_password
POSTGRES_DB_NAME = _postgres.postgres_db_name
POSTGRES_HOST = _postgres.effective_host
POSTGRES_PORT = _postgres.effective_port
POSTGRES_GENERAL_DB_URL = _postgres.general_db_url
POSTGRES_DB_URL = _postgres.db_url

# Valkey exports (backward compatibility)
VALKEY_HOST = _valkey.effective_host
VALKEY_PORT = _valkey.effective_port
VALKEY_DB = _valkey.valkey_db
VALKEY_SPOT_EXPIRATION = _collectors.valkey_spot_expiration
VALKEY_GEO_EXPIRATION = _valkey.valkey_geo_expiration

# QRZ exports (backward compatibility) - TYPO FIXED: QRZ_PASSOWRD -> QRZ_PASSWORD
QRZ_USER = _qrz.qrz_user
QRZ_PASSWORD = _qrz.qrz_password
QRZ_API_KEY = _qrz.qrz_api_key
QRZ_SESSION_KEY_REFRESH = _qrz.qrz_session_key_refresh

# Collectors-specific exports (backward compatibility)
DEBUG = _collectors.debug
POSTGRES_DB_RETENTION_DAYS = _collectors.postgres_db_retention_days
USERNAME_FOR_TELNET_CLUSTERS = _collectors.username_for_telnet_clusters

# Docker detection
IN_DOCKER = _postgres._in_docker

# New-style exports (optional for future use)
postgres_settings = _postgres
valkey_settings = _valkey
qrz_settings = _qrz
collectors_settings = _collectors
