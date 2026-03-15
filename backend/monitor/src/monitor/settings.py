from pydantic import Field
from shared.settings import ValkeySettings


class MonitorSettings(ValkeySettings):
    instance_name: str = Field(description="Instance name prepended to every alert")
    check_interval: int = Field(default=60, description="Seconds between check cycles")
    spot_flow_timeout: int = Field(default=300, description="Max age in seconds for last_spot_time before unhealthy")
    heartbeat_timeout: int = Field(default=200, description="Max age in seconds for heartbeat before unhealthy")
    ws_url: str = Field(default="ws://api:8000/spots_ws", description="WebSocket URL for synthetic client check")

    telegram_bot_token: str = Field(description="Telegram Bot API token")
    telegram_chat_id: str = Field(description="Telegram chat ID for alerts")


settings = MonitorSettings()
