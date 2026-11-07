"""Cross-check critical scrape target coverage in monitoring configuration."""

import re
import unittest
from pathlib import Path

import yaml


BACKEND = Path(__file__).resolve().parents[1]
MONITORING = BACKEND / "infra/monitoring"


class MonitoringConfigTests(unittest.TestCase):
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
