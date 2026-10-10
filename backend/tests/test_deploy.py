"""Deploy regression tests using only temporary shell stubs, not Git or Docker."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1] / "deploy.sh"
INITIAL_ENV = "DUMMY_SETTING=test\nSENTRY_RELEASE=oldhead\n"
BACKGROUND_SERVICES = {"api", "collector", "postgres", "valkey"}

GIT_STUB = """#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$FIXTURE/git.log"
case "$1" in
    rev-parse)
        if [[ -f "$FIXTURE/checked" || "$SAME_REF" == 1 ]]; then
            echo newhead
        else
            echo oldhead
        fi
        ;;
    checkout)
        if [[ "$CHECKOUT_MODE" == fail ]]; then exit 23; fi
        if [[ "$CHECKOUT_MODE" == fallback && "$2" != -b ]]; then exit 23; fi
        if [[ "$CHECKOUT_MODE" == tracked && "$2" == dev ]]; then exit 24; fi
        touch "$FIXTURE/checked"
        ;;
    reset) ;;
    diff) printf '%s\\n' "$CHANGED_FILES" ;;
    *) exit 90 ;;
esac
"""

DOCKER_STUB = """#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$FIXTURE/docker.log"
project_name="${COMPOSE_PROJECT_NAME-$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env | tail -n 1)}"
proxy_network_input="${PROXY_NETWORK-$(sed -n 's/^PROXY_NETWORK=//p' .env | tail -n 1)}"
proxy_network="${proxy_network_input:-holycluster-proxy}"
if [[ "$*" == 'compose config '* ]]; then
    if [[ -z "$project_name" ]]; then exit 14; fi
    if [[ "$CONFIG_STATUS" != 0 ]]; then exit "$CONFIG_STATUS"; fi
    if [[ "$*" == 'compose config --environment' ]]; then
        printf 'PROXY_NETWORK=%s\\n' "$proxy_network_input"
        exit "$ENVIRONMENT_CONFIG_STATUS"
    fi
    exit 0
fi
if [[ "$*" == "network inspect $proxy_network" ]]; then
    if [[ "$MISSING_NETWORK" == "$proxy_network" ]]; then exit 15; fi
    exit 0
fi
if [[ "$1" == inspect ]]; then
    name="${!#}"
    case ",$LEGACY_NAMES," in
        *,"$name",*)
            if [[ "$*" == *--format* ]]; then echo legacy; fi
            exit 0 ;;
    esac
    exit 1
fi
if [[ "$*" == 'compose build '* && -z "$project_name" ]]; then exit 14; fi
if [[ "$*" == 'compose up '* && "$MISSING_NETWORK" == "$proxy_network" ]]; then exit 15; fi
if [[ "$*" == 'compose up --abort-on-container-exit --exit-code-from migrate migrate' ]]; then
    exit "$MIGRATION_STATUS"
fi
if [[ "$*" == 'compose up -d --no-deps '* ]]; then
    service="${!#}"
    # A separate file per service avoids interleaved writes from parallel jobs.
    printf '%s\\n' "$$" > "$FIXTURE/start-$service"
    case ",$FAIL_SERVICES," in
        *,"$service",*) exit 37 ;;
    esac
fi
"""

# Record explicit waits while preserving Bash's real wait behavior. This makes
# the all-jobs assertion deterministic, without timing assumptions or sleeps.
WAIT_STUB = """wait() {
    printf '%s\\n' "$*" >> "$FIXTURE/wait.log"
    builtin wait "$@"
}
"""


class DeployTests(unittest.TestCase):
    def run_deploy(self, **overrides):
        temporary = tempfile.TemporaryDirectory(prefix="holy-deploy-test-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / "bin").mkdir()
        (root / "deploy.sh").write_text(DEPLOY.read_text())
        (root / ".env").write_text(overrides.pop("dotenv", INITIAL_ENV))
        (root / "wait.sh").write_text(WAIT_STUB)
        for name, content in (("git", GIT_STUB), ("docker", DOCKER_STUB)):
            stub = root / "bin" / name
            stub.write_text(content)
            stub.chmod(0o755)
        env = {
            "PATH": f"{root / 'bin'}:{os.defpath}",
            "FIXTURE": str(root),
            "BASH_ENV": str(root / "wait.sh"),
            "CHECKOUT_MODE": "success",
            "SAME_REF": "0",
            "CHANGED_FILES": "docker-compose.yml",
            "MIGRATION_STATUS": "0",
            "FAIL_SERVICES": "",
            "COMPOSE_PROJECT_NAME": "holycluster-backend-dev",
            "CONFIG_STATUS": "0",
            "ENVIRONMENT_CONFIG_STATUS": "0",
            "MISSING_NETWORK": "",
            "LEGACY_NAMES": "",
        }
        ref = overrides.pop("ref", "release-tag")
        env.update(overrides)
        result = subprocess.run(
            ["bash", "deploy.sh", ref], cwd=root, env=env, text=True, capture_output=True, timeout=10, check=False
        )
        return root, result

    def assert_all_waited(self, root, services=BACKGROUND_SERVICES):
        starts = {path.name.removeprefix("start-"): path.read_text().strip() for path in root.glob("start-*")}
        background = {service: pid for service, pid in starts.items() if service not in {"nginx", "certbot"}}
        self.assertEqual(set(background), services)
        waits = (root / "wait.log").read_text().splitlines() if services else []
        self.assertCountEqual(waits, background.values())

    def test_unrecoverable_checkout_aborts_before_env_or_docker(self):
        for mode, ref, status in (("fail", "release-tag", 23), ("tracked", "origin/dev", 24)):
            with self.subTest(mode=mode):
                root, result = self.run_deploy(CHECKOUT_MODE=mode, ref=ref)
                self.assertEqual(result.returncode, status, result.stderr)
                self.assertEqual((root / ".env").read_text(), INITIAL_ENV)
                self.assertFalse((root / "docker.log").exists())
                self.assertNotIn("Deploy complete.", result.stdout)
                checkouts = [
                    line for line in (root / "git.log").read_text().splitlines() if line.startswith("checkout")
                ]
                self.assertEqual(len(checkouts), 2)
                if mode == "fail":
                    self.assertEqual(checkouts[-1], "checkout -b release-tag origin/release-tag")
                else:
                    self.assertNotIn("reset --hard", (root / "git.log").read_text())

    def test_fallback_checkout_can_succeed(self):
        root, result = self.run_deploy(CHECKOUT_MODE="fallback")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_all_waited(root)

    def test_each_startup_failure_propagates_and_waits_for_every_job(self):
        for service in sorted(BACKGROUND_SERVICES | {"nginx"}):
            with self.subTest(service=service):
                root, result = self.run_deploy(FAIL_SERVICES=service)
                self.assertEqual(result.returncode, 37, result.stderr)
                self.assertNotIn("Deploy complete.", result.stdout)
                self.assert_all_waited(root)
                if service != "nginx":
                    self.assertIn(f"Failed to start {service} (exit 37).", result.stderr)
                    self.assertFalse((root / "start-nginx").exists())

    def test_multiple_startup_failures_are_all_waited_and_reported(self):
        root, result = self.run_deploy(FAIL_SERVICES="api,collector,postgres,valkey")
        self.assertEqual(result.returncode, 37, result.stderr)
        self.assert_all_waited(root)
        for service in BACKGROUND_SERVICES:
            self.assertIn(f"Failed to start {service} (exit 37).", result.stderr)
        self.assertNotIn("Deploy complete.", result.stdout)

    def test_migration_failure_still_propagates(self):
        root, result = self.run_deploy(MIGRATION_STATUS="42")
        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertFalse(list(root.glob("start-*")))
        self.assertFalse((root / "wait.log").exists())
        self.assertNotIn("Deploy complete.", result.stdout)

    def test_success_updates_env_and_waits_for_all_jobs(self):
        root, result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_all_waited(root)
        self.assertTrue((root / "start-nginx").exists())
        self.assertEqual((root / ".env").read_text(), INITIAL_ENV.replace("oldhead", "newhead"))
        self.assertIn("Deploy complete.", result.stdout)

    def test_nginx_only_success_has_no_background_jobs(self):
        root, result = self.run_deploy(CHANGED_FILES="infra/nginx/nginx.conf")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_all_waited(root, set())
        self.assertFalse((root / "wait.log").exists())
        self.assertTrue((root / "start-nginx").exists())

    def assert_no_removals_or_builds(self, root):
        calls = (root / "docker.log").read_text().splitlines()
        self.assertFalse(any(call.startswith(("rm ", "compose build ", "compose up ")) for call in calls))
        self.assertFalse(list(root.glob("start-*")))

    def test_missing_project_name_aborts_before_legacy_removal(self):
        root, result = self.run_deploy(COMPOSE_PROJECT_NAME="", LEGACY_NAMES="api,monitor,nginx")
        self.assertEqual(result.returncode, 14, result.stderr)
        self.assert_no_removals_or_builds(root)

    def test_missing_effective_proxy_network_aborts_before_legacy_removal(self):
        for overrides, network in (
            ({}, "holycluster-proxy"),
            ({"PROXY_NETWORK": ""}, "holycluster-proxy"),
            ({"PROXY_NETWORK": "exported-proxy"}, "exported-proxy"),
            ({"dotenv": INITIAL_ENV + "PROXY_NETWORK=dotenv-proxy\n"}, "dotenv-proxy"),
            (
                {"dotenv": INITIAL_ENV + "PROXY_NETWORK=dotenv-proxy\n", "PROXY_NETWORK": "exported-proxy"},
                "exported-proxy",
            ),
        ):
            with self.subTest(network=network, overrides=overrides):
                root, result = self.run_deploy(LEGACY_NAMES="api,monitor,nginx", MISSING_NETWORK=network, **overrides)
                self.assertEqual(result.returncode, 15, result.stderr)
                self.assert_no_removals_or_builds(root)
                self.assertIn(f"network inspect {network}", (root / "docker.log").read_text().splitlines())

    def test_valid_configuration_checks_network_before_legacy_migration(self):
        root, result = self.run_deploy(LEGACY_NAMES="api,monitor,nginx", PROXY_NETWORK="exported-proxy")
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = (root / "docker.log").read_text().splitlines()
        self.assertEqual(
            [call for call in calls if call.startswith("rm ")], ["rm -f api", "rm -f monitor", "rm -f nginx"]
        )
        self.assertIn("compose config --quiet", calls)
        self.assertIn("compose config --environment", calls)
        self.assertIn("network inspect exported-proxy", calls)
        self.assertLess(calls.index("compose config --quiet"), calls.index("compose config --environment"))
        self.assertLess(calls.index("compose config --environment"), calls.index("network inspect exported-proxy"))
        self.assertLess(calls.index("network inspect exported-proxy"), calls.index("rm -f api"))
        self.assert_all_waited(root)
        self.assertFalse((root / "start-monitor").exists())
        self.assertTrue((root / "start-certbot").exists())

    def test_configuration_validation_failure_aborts_before_legacy_removal(self):
        root, result = self.run_deploy(LEGACY_NAMES="api,monitor,nginx", CONFIG_STATUS="41")
        self.assertEqual(result.returncode, 41, result.stderr)
        self.assert_no_removals_or_builds(root)

    def test_environment_configuration_query_failure_aborts_before_legacy_removal(self):
        root, result = self.run_deploy(LEGACY_NAMES="api,monitor,nginx", ENVIRONMENT_CONFIG_STATUS="43")
        self.assertEqual(result.returncode, 43, result.stderr)
        self.assert_no_removals_or_builds(root)

    def test_same_ref_remains_a_no_op(self):
        root, result = self.run_deploy(SAME_REF="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No new commits. Nothing to deploy.", result.stdout)
        self.assertEqual((root / ".env").read_text(), INITIAL_ENV)
        self.assertFalse((root / "docker.log").exists())


if __name__ == "__main__":
    unittest.main()
