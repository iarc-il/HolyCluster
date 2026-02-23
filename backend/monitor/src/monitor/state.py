from enum import Enum


class HealthStatus(Enum):
    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


class CheckState:
    def __init__(self, name: str):
        self.name = name
        self.status = HealthStatus.UNKNOWN
        self.last_message = ""

    def update(self, new_status: HealthStatus, message: str = "") -> str | None:
        """Update status and return an alert message if the state transitioned, else None."""
        previous = self.status
        self.status = new_status
        self.last_message = message

        if previous == new_status:
            return None
        if previous == HealthStatus.UNKNOWN and new_status == HealthStatus.HEALTHY:
            return None

        if new_status == HealthStatus.UNHEALTHY:
            return f"UNHEALTHY: {self.name}\n{message}"
        if new_status == HealthStatus.HEALTHY and previous == HealthStatus.UNHEALTHY:
            return f"RECOVERED: {self.name}\n{message}"

        return None
