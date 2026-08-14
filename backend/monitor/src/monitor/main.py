import asyncio

import redis.asyncio
from loguru import logger

from monitor.alerting.telegram import TelegramNotifier
from monitor.checks.containers import check_containers
from monitor.checks.metrics import check_metrics
from monitor.checks.spot_flow import check_websocket
from monitor.settings import settings
from monitor.state import Alert, CheckState
from shared.telemetry import capture_exception, initialize_sentry


async def run_monitor():
    if not settings.monitor_enabled:
        logger.info("Monitor is disabled, exiting...")
        return

    logger.info("Starting monitor...")

    valkey = redis.asyncio.Redis(
        host=settings.valkey_effective_host,
        port=settings.valkey_effective_port,
        db=int(settings.valkey_db),
        decode_responses=True,
    )

    notifiers = [TelegramNotifier(settings.telegram_bot_token, settings.telegram_chat_id, settings.instance_name)]
    logger.info("Telegram alerting enabled")

    collector_heartbeat = CheckState("collector:heartbeat")
    api_heartbeat = CheckState("api:heartbeat")
    spot_flow = CheckState("spot_flow:last_spot_time")
    ws_state = CheckState("websocket")
    telnet_states: dict[str, CheckState] = {}

    container_states = ["postgres", "valkey", "collector", "api", "nginx"]
    container_states: dict[str, CheckState] = {
        name: CheckState(f"Container {name} state=UNKNOWN") for name in container_states
    }

    while True:
        all_alerts: list[Alert] = []

        try:
            metric_alerts = await check_metrics(
                valkey=valkey,
                heartbeat_timeout=settings.heartbeat_timeout,
                spot_flow_timeout=settings.spot_flow_timeout,
                collector_heartbeat_state=collector_heartbeat,
                api_heartbeat_state=api_heartbeat,
                spot_flow_state=spot_flow,
                telnet_states=telnet_states,
            )
            all_alerts.extend(metric_alerts)
        except Exception as e:
            logger.exception("Metrics check failed")
            capture_exception(e)

        try:
            ws_alert = await check_websocket(settings.ws_url, ws_state)
            if ws_alert:
                all_alerts.append(ws_alert)
        except Exception as e:
            logger.exception("WebSocket check failed")
            capture_exception(e)

        try:
            container_alerts = await check_containers(container_states)
            all_alerts.extend(container_alerts)
        except Exception as e:
            logger.exception("Container check failed")
            capture_exception(e)

        if all_alerts:
            logger.warning(f"{len(all_alerts)} alert(s) this cycle")
            for alert in all_alerts:
                logger.warning(alert.message)
            for notifier in notifiers:
                try:
                    await notifier.send_alerts(all_alerts)
                except Exception as e:
                    logger.exception("Failed to send alert")
                    capture_exception(e)
        else:
            logger.info("All checks passed")

        await asyncio.sleep(settings.check_interval)


def main():
    initialize_sentry(settings, "monitor")
    asyncio.run(run_monitor())


if __name__ == "__main__":
    main()
