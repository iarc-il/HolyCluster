import asyncio
import json

from loguru import logger

from monitor.state import Alert, CheckState, HealthStatus


async def check_containers(
    states: dict[str, CheckState],
) -> list[Alert]:
    alerts = []
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker",
            "ps",
            "--format",
            "{{json .}}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)

        if proc.returncode != 0:
            logger.error(f"docker ps failed: {stderr.decode()}")
            return alerts

        missing_states = [name for name in states]

        for line in stdout.decode().strip().splitlines():
            try:
                container = json.loads(line)
            except json.JSONDecodeError:
                continue

            name = container.get("Names", "unknown")
            state = container.get("State", "")
            status = container.get("Status", "")

            missing_states.remove(name)

            if name not in states:
                states[name] = CheckState(f"container:{name}")

            if state != "running":
                alert = states[name].update(HealthStatus.UNHEALTHY, f"Container {name} state={state}")
            elif "unhealthy" in status.lower():
                alert = states[name].update(HealthStatus.UNHEALTHY, f"Container {name} status={status}")
            else:
                alert = states[name].update(HealthStatus.HEALTHY, f"Container {name} running")

            if alert:
                alerts.append(alert)

        for name in missing_states:
            alert = states[name].update(HealthStatus.UNHEALTHY, f"Container {name} missing")
            alerts.append(alert)

    except TimeoutError:
        logger.error("docker ps timed out")
    except FileNotFoundError:
        logger.warning("docker command not found, skipping container check")
    except Exception:
        logger.exception("Container check failed")

    return alerts
