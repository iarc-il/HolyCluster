from abc import ABC, abstractmethod


class AlertNotifier(ABC):
    @abstractmethod
    async def send_alert(self, subject: str, body: str):
        pass
