from abc import ABC, abstractmethod

from monitor.state import Alert


class AlertNotifier(ABC):
    @abstractmethod
    async def send_alerts(self, alerts: list[Alert]):
        pass
