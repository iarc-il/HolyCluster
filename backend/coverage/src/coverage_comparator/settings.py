from pydantic_settings import SettingsConfigDict
from shared.settings import LogSettings, PostgresSettings, SentrySettings, ValkeySettings


class Settings(PostgresSettings, ValkeySettings, LogSettings, SentrySettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
