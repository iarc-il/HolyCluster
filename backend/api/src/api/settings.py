from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from shared.settings import PostgresSettings, QrzSettings, ValkeySettings


class ApiSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    ui_dist_path: Path = Field(..., description="Path to UI distribution files")
    catserver_msi_dir: Path = Field(..., description="Path to CATServer MSI directory")
    spots_log_path: str = Field(..., description="Path to spots log file")


# Instantiate settings singletons
_postgres = PostgresSettings()
_valkey = ValkeySettings()
_qrz = QrzSettings()
_api = ApiSettings()

# PostgreSQL exports (backward compatibility)
POSTGRES_USER = _postgres.postgres_user
DATABASE = _postgres.postgres_db_name
POSTGRES_HOST = _postgres.effective_host
POSTGRES_PORT = _postgres.effective_port
GENERAL_DB_URL = _postgres.general_db_url
DB_URL = _postgres.db_url

# Valkey exports (backward compatibility)
VALKEY_HOST = _valkey.effective_host
VALKEY_PORT = _valkey.effective_port
VALKEY_DB = _valkey.valkey_db
VALKEY_GEO_EXPIRATION = _valkey.valkey_geo_expiration

# QRZ exports (backward compatibility)
QRZ_USER = _qrz.qrz_user
QRZ_PASSWORD = _qrz.qrz_password
QRZ_API_KEY = _qrz.qrz_api_key
QRZ_SESSION_KEY_REFRESH = _qrz.qrz_session_key_refresh

# API-specific exports (backward compatibility)
UI_DIST_PATH = _api.ui_dist_path
CATSERVER_MSI_DIR = _api.catserver_msi_dir
SPOTS_LOG_PATH = _api.spots_log_path

# Docker detection
IN_DOCKER = _postgres._in_docker

# New-style exports (optional for future use)
postgres_settings = _postgres
valkey_settings = _valkey
qrz_settings = _qrz
api_settings = _api
