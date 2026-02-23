import asyncio
import json

from loguru import logger

from monitor.state import Alert, CheckState, HealthStatus


async def check_containers(
    compose_project_dir: str,
    states: dict[str, CheckState],
) -> list[Alert]:
    alerts = []
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker",
            "compose",
            "ps",
            "--format",
            "json",
            cwd=compose_project_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)

        if proc.returncode != 0:
            logger.error(f"docker compose ps failed: {stderr.decode()}")
            return alerts

        for line in stdout.decode().strip().splitlines():
            try:
                container = json.loads(line)
            except json.JSONDecodeError:
                continue

            name = container.get("Name", container.get("Service", "unknown"))
            state = container.get("State", "")
            health = container.get("Health", "")

            if name not in states:
                states[name] = CheckState(f"container:{name}")

            if state != "running":
                alert = states[name].update(HealthStatus.UNHEALTHY, f"Container {name} state={state}")
            elif health and health != "healthy":
                alert = states[name].update(HealthStatus.UNHEALTHY, f"Container {name} health={health}")
            else:
                alert = states[name].update(HealthStatus.HEALTHY, f"Container {name} running")

            if alert:
                alerts.append(alert)

    except TimeoutError:
        logger.error("docker compose ps timed out")
    except FileNotFoundError:
        logger.warning("docker command not found, skipping container check")
    except Exception:
        logger.exception("Container check failed")

    return alerts
