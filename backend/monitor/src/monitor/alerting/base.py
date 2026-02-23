from abc import ABC, abstractmethod

from monitor.state import Alert


class AlertNotifier(ABC):
    @abstractmethod
    async def send_alert(self, subject: str, alert: Alert):
        pass
