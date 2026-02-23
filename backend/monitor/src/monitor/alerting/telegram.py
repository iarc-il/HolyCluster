import httpx
from loguru import logger

from .base import AlertNotifier


class TelegramNotifier(AlertNotifier):
    def __init__(self, bot_token: str, chat_id: str):
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.client = httpx.AsyncClient(timeout=10)

    async def send_alert(self, subject: str, body: str):
        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
        text = f"\U0001f534 {subject}\n{body}"
        try:
            resp = await self.client.post(
                url,
                json={
                    "chat_id": self.chat_id,
                    "text": text,
                    "parse_mode": "HTML",
                },
            )
            if resp.status_code != 200:
                logger.error(f"Telegram API error: {resp.status_code} {resp.text}")
        except Exception:
            logger.exception("Failed to send Telegram alert")
