"""Cross-check critical scrape target coverage in monitoring configuration."""

import json
import re
import unittest
from pathlib import Path

import yaml
from coverage_comparator.adapters import SERVICES


BACKEND = Path(__file__).resolve().parents[1]
MONITORING = BACKEND / "infra/monitoring"


class MonitoringConfigTests(unittest.TestCase):
    def test_grafana_mcp_is_private_and_read_only(self):
        compose = yaml.safe_load((BACKEND / "docker-compose.yml").read_text())
        service = compose["services"]["grafana-mcp"]
        self.assertEqual(service["profiles"], ["grafana-mcp"])
        self.assertEqual(service["ports"], ["127.0.0.1:${GRAFANA_MCP_PORT:-8001}:8000"])
        self.assertEqual(service["image"], "grafana/mcp-grafana:2.3.0-alpine")
        self.assertTrue(service["read_only"])
        self.assertEqual(service["cap_drop"], ["ALL"])
        self.assertEqual(service["environment"]["GRAFANA_URL"], "http://grafana:3000/grafana")
        command = service["command"]
        self.assertIn("--disable-write", command)
        self.assertIn("--enable-query", command)
        self.assertIn("--usage-stats=disabled", command)
        self.assertIn(
            "--allowed-hosts=localhost:${GRAFANA_MCP_PORT:-8001},127.0.0.1:${GRAFANA_MCP_PORT:-8001},localhost:8000,127.0.0.1:8000",
            command,
        )
        self.assertIn("--enabled-tools=search,datasource,prometheus,dashboard,alerting,sql,navigation", command)
        entrypoint = service["entrypoint"][2]
        for name in ("GRAFANA_SERVICE_ACCOUNT_TOKEN", "MCP_GRAFANA_SERVER_TOKEN"):
            self.assertIn(f': "$${{{name}:?', entrypoint)
        self.assertIn('exec /app/mcp-grafana "$$@"', entrypoint)

    def test_coverage_dashboard_lists_every_fixed_service(self):
        dashboard = json.loads((MONITORING / "grafana/dashboards/spot-coverage.json").read_text())
        variables = {variable["name"]: variable for variable in dashboard["templating"]["list"]}
        service = variables["service"]
        self.assertEqual(tuple(service["query"].split(",")), SERVICES)
        self.assertEqual(
            tuple(option["value"] for option in service["options"] if option["value"] != "$__all"),
            SERVICES,
        )

    def test_target_down_covers_deployed_scrape_jobs(self):
        alerts = yaml.safe_load((MONITORING / "grafana/provisioning/alerting/health.yml").read_text())
        rules = [rule for group in alerts["groups"] for rule in group["rules"]]
        target_rules = [rule for rule in rules if rule["uid"] == "hc-target-down"]
        self.assertEqual(len(target_rules), 1)
        queries = [data for data in target_rules[0]["data"] if data["refId"] == "A"]
        self.assertEqual(len(queries), 1)
        expression = queries[0]["model"]["expr"]
        selector = re.search(r"\bup\s*\{([^}]*)\}", expression)
        self.assertIsNotNone(selector, "Target-down query must select up metrics")
        matcher = re.search(r'\bjob\s*=~\s*"([^"]+)"', selector.group(1))
        self.assertIsNotNone(matcher, "Target-down query must explicitly match scrape jobs")
        alert_jobs = set(matcher.group(1).split("|"))

        scrape = yaml.safe_load((MONITORING / "victoriametrics/scrape.yml").read_text())
        scrape_jobs = {job["job_name"] for job in scrape["scrape_configs"]}
        compose = yaml.safe_load((BACKEND / "docker-compose.yml").read_text())
        deployed_jobs = scrape_jobs & set(compose["services"])
        self.assertTrue({"api", "collector", "coverage"} <= deployed_jobs)
        self.assertEqual(alert_jobs, deployed_jobs)
