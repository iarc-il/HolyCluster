import httpx
from loguru import logger

from monitor.state import Alert

from .base import AlertNotifier


class TelegramNotifier(AlertNotifier):
    def __init__(self, bot_token: str, chat_id: str):
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.client = httpx.AsyncClient(timeout=10)

    async def send_alerts(self, alerts: list[Alert]):
        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
        lines = []
        for alert in alerts:
            emoji = "\U0001f7e2" if alert.healthy else "\U0001f534"
            lines.append(f"{emoji} {alert.message}")
        text = "\n".join(lines)
        try:
            resp = await self.client.post(
                url,
                json={
                    "chat_id": self.chat_id,
                    "text": text,
                },
            )
            if resp.status_code != 200:
                logger.error(f"Telegram API error: {resp.status_code} {resp.text}")
        except Exception:
            logger.exception("Failed to send Telegram alert")
