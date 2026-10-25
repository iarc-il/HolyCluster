"""Deploy regression tests using only temporary shell stubs, not Git or Docker."""

import fcntl
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1] / "deploy.sh"
INITIAL_ENV = "DUMMY_SETTING=test\nSENTRY_RELEASE=oldhead\n"
BACKGROUND_SERVICES = {"api", "collector", "postgres", "valkey", "victoriametrics", "grafana"}

GIT_STUB = """#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$FIXTURE/git.log"
case "$1" in
    rev-parse)
        if [[ "${2-}" == --git-path ]]; then
            printf '%s/deployed\\n' "$FIXTURE"
        elif [[ -f "$FIXTURE/checked" || "$SAME_REF" == 1 ]]; then
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
if [[ -f "$FIXTURE/deployed" ]]; then
    printf '%s\\n' "$(< "$FIXTURE/deployed")" >> "$FIXTURE/marker-at-docker.log"
else
    echo absent >> "$FIXTURE/marker-at-docker.log"
fi
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
if [[ "$*" == 'compose ps --all --quiet grafana' ]]; then
    if [[ "$GRAFANA_STATE" != missing ]]; then echo grafana-id; fi
    exit 0
fi
if [[ "$*" == inspect*grafana-id ]]; then
    printf '%s\\n' "$GRAFANA_STATE"
    exit 0
fi
if [[ "$*" == 'compose run '* ]]; then
    if [[ "$*" == *'--user 0 '* ]]; then
        if [[ "$GRAFANA_PASSWORD_STATUS" != 0 ]]; then
            echo 'Set GRAFANA_ADMIN_PASSWORD before deploying Grafana.' >&2
            exit "$GRAFANA_PASSWORD_STATUS"
        fi
        exit "$OWNERSHIP_STATUS"
    fi
    exit "$WRITABLE_STATUS"
fi
if [[ "$*" == 'compose up -d --no-deps --wait '* ]]; then
    for service in ${@:8}; do
        case ",$UNHEALTHY_SERVICES," in
            *,"$service",*) exit 44 ;;
        esac
        if [[ "$service" == grafana && "$GRAFANA_HEALTH_STATUS" != 0 ]]; then
            exit "$GRAFANA_HEALTH_STATUS"
        fi
    done
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
if [[ "$*" == 'compose build '* ]]; then
    if [[ -z "$project_name" ]]; then exit 14; fi
    exit "$BUILD_STATUS"
fi
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


MV_STUB = """#!/usr/bin/env bash
set -eu
printf '%s|%s|%s\\n' "$1" "$2" "$(< "$1")" >> "$FIXTURE/mv.log"
if [[ "$2" == "$FIXTURE/deployed" && "$MARKER_WRITE_STATUS" != 0 ]]; then
    exit "$MARKER_WRITE_STATUS"
fi
exec /usr/bin/mv "$@"
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
        for name, content in (("git", GIT_STUB), ("docker", DOCKER_STUB), ("mv", MV_STUB)):
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
            "BUILD_STATUS": "0",
            "MARKER_WRITE_STATUS": "0",
            "ENVIRONMENT_CONFIG_STATUS": "0",
            "MISSING_NETWORK": "",
            "LEGACY_NAMES": "",
            "GRAFANA_STATE": "running healthy",
            "GRAFANA_PASSWORD_STATUS": "0",
            "OWNERSHIP_STATUS": "0",
            "WRITABLE_STATUS": "0",
            "GRAFANA_HEALTH_STATUS": "0",
            "UNHEALTHY_SERVICES": "",
        }
        ref = overrides.pop("ref", "release-tag")
        marker = overrides.pop("deployed_head", None)
        if marker is not None:
            (root / "deployed").write_text(marker + "\n")
        env.update(overrides)
        self.last_env = env
        result = subprocess.run(
            ["bash", "deploy.sh", ref], cwd=root, env=env, text=True, capture_output=True, timeout=10, check=False
        )
        return root, result

    def rerun_deploy(self, root, **overrides):
        env = {**self.last_env, **overrides}
        return subprocess.run(
            ["bash", "deploy.sh", "release-tag"],
            cwd=root,
            env=env,
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )

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
        for service in {"api", "collector", "postgres", "valkey"}:
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

    def test_unrelated_deploy_does_not_require_monitoring_credentials(self):
        for path, services in (
            ("infra/nginx/nginx.conf.template", set()),
            ("api/src/api/main.py", {"api"}),
        ):
            with self.subTest(path=path):
                root, result = self.run_deploy(CHANGED_FILES=path)
                self.assertNotIn("GRAFANA_ADMIN_PASSWORD", (root / ".env").read_text())
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assert_all_waited(root, services)
                self.assertTrue((root / "start-nginx").exists())
                self.assertFalse((root / "start-grafana").exists())
                self.assertFalse((root / "start-victoriametrics").exists())

    def test_monitoring_changes_select_services_without_migrations(self):
        for path, services in (
            ("infra/monitoring/victoriametrics/scrape.yml", {"victoriametrics"}),
            ("infra/monitoring/grafana/provisioning/datasources/default.yml", {"grafana"}),
            ("infra/monitoring/grafana/provisioning/dashboards/default.yml", {"grafana"}),
            ("infra/monitoring/grafana/dashboards/overview.json", {"grafana"}),
        ):
            with self.subTest(path=path):
                root, result = self.run_deploy(CHANGED_FILES=path)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assert_all_waited(root, services)
                calls = (root / "docker.log").read_text().splitlines()
                self.assertFalse(any("--exit-code-from migrate" in call for call in calls))
                self.assertFalse((root / "start-nginx").exists())
                for service in services:
                    self.assertIn(f"compose up -d --no-deps --force-recreate {service}", calls)

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

    def test_failed_first_deploy_retries_the_full_pending_service_set(self):
        root, result = self.run_deploy(GRAFANA_PASSWORD_STATUS="41")
        self.assertEqual(result.returncode, 41, result.stderr)
        self.assertFalse((root / "deployed").exists())
        self.assertEqual((root / "deployed.base").read_text(), "oldhead\n")
        retried = self.rerun_deploy(root, GRAFANA_PASSWORD_STATUS="0")
        self.assertEqual(retried.returncode, 0, retried.stderr)
        self.assert_all_waited(root)
        self.assertTrue((root / "start-nginx").exists())
        self.assertTrue((root / "start-certbot").exists())
        self.assertEqual((root / "deployed").read_text(), "newhead\n")
        diffs = [line for line in (root / "git.log").read_text().splitlines() if line.startswith("diff ")]
        self.assertEqual(diffs, ["diff --name-only --relative oldhead newhead -- ."] * 2)

    def test_success_marker_advances_only_after_health_and_uses_atomic_rename(self):
        root, result = self.run_deploy(deployed_head="lastsuccess")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set((root / "marker-at-docker.log").read_text().splitlines()), {"lastsuccess"})
        self.assertEqual((root / "deployed").read_text(), "newhead\n")
        source, destination, revision = (root / "mv.log").read_text().strip().split("|")
        self.assertEqual(Path(source).parent, root)
        self.assertTrue(Path(source).name.startswith("deployed.tmp."))
        self.assertEqual(destination, str(root / "deployed"))
        self.assertEqual(revision, "newhead")
        self.assertFalse(Path(source).exists())
        self.assertIn("diff --name-only --relative lastsuccess newhead -- .", (root / "git.log").read_text())

    def test_failures_do_not_advance_existing_success_marker(self):
        for overrides in (
            {"GRAFANA_PASSWORD_STATUS": "41"},
            {"BUILD_STATUS": "45"},
            {"FAIL_SERVICES": "api"},
            {"GRAFANA_HEALTH_STATUS": "44"},
        ):
            with self.subTest(overrides=overrides):
                root, result = self.run_deploy(deployed_head="lastsuccess", **overrides)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual((root / "deployed").read_text(), "lastsuccess\n")
                self.assertFalse((root / "mv.log").exists())

    def test_failed_atomic_marker_rename_preserves_previous_revision(self):
        root, result = self.run_deploy(deployed_head="lastsuccess", MARKER_WRITE_STATUS="46")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((root / "deployed").read_text(), "lastsuccess\n")
        self.assertFalse(list(root.glob("deployed.tmp.*")))
        self.assertNotIn("Deploy complete.", result.stdout)

    def test_no_backend_or_service_changes_advance_success_marker(self):
        for changed in ("", "unmapped-file.txt"):
            with self.subTest(changed=changed):
                root, result = self.run_deploy(CHANGED_FILES=changed, deployed_head="lastsuccess")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((root / "deployed").read_text(), "newhead\n")
                self.assertFalse(list(root.glob("start-*")))

    def test_grafana_preflight_failure_aborts_before_build_or_start(self):
        for overrides, status in (
            ({"GRAFANA_PASSWORD_STATUS": "41"}, 41),
            ({"OWNERSHIP_STATUS": "42"}, 42),
            ({"WRITABLE_STATUS": "43"}, 43),
        ):
            with self.subTest(overrides=overrides):
                root, result = self.run_deploy(
                    CHANGED_FILES="infra/monitoring/grafana/provisioning/datasources/default.yml", **overrides
                )
                self.assertEqual(result.returncode, status, result.stderr)
                self.assert_no_removals_or_builds(root)
                self.assertNotIn("Deploy complete.", result.stdout)

    def test_missing_grafana_password_prevents_legacy_removal(self):
        root, result = self.run_deploy(GRAFANA_PASSWORD_STATUS="41", LEGACY_NAMES="api,monitor,nginx")
        self.assertEqual(result.returncode, 41, result.stderr)
        self.assert_no_removals_or_builds(root)

    def test_grafana_health_failure_does_not_prevent_product_start(self):
        root, result = self.run_deploy(GRAFANA_HEALTH_STATUS="44")
        self.assertEqual(result.returncode, 44, result.stderr)
        self.assert_all_waited(root)
        self.assertTrue((root / "start-nginx").exists())
        calls = (root / "docker.log").read_text().splitlines()
        health = "compose up -d --no-deps --wait --wait-timeout 120 api collector nginx victoriametrics grafana"
        self.assertIn(health, calls)
        self.assertLess(calls.index("compose up -d --no-deps nginx"), calls.index(health))
        self.assertNotIn("Deploy complete.", result.stdout)

    def test_selected_service_health_failure_preserves_marker(self):
        for service, path in (
            ("api", "api/src/api/main.py"),
            ("nginx", "infra/nginx/nginx.conf"),
            ("collector", "collectors/src/collectors/main.py"),
            ("victoriametrics", "infra/monitoring/victoriametrics/scrape.yml"),
            ("grafana", "infra/monitoring/grafana/dashboards/overview.json"),
        ):
            with self.subTest(service=service):
                root, result = self.run_deploy(
                    CHANGED_FILES=path, UNHEALTHY_SERVICES=service, deployed_head="lastsuccess"
                )
                self.assertEqual(result.returncode, 44, result.stderr)
                self.assertEqual((root / "deployed").read_text(), "lastsuccess\n")
                self.assertNotIn("Deploy complete.", result.stdout)

    def test_rollback_then_redeploy_uses_checkout_and_retains_retry_base(self):
        root, result = self.run_deploy(deployed_head="newhead", BUILD_STATUS="45")
        self.assertEqual(result.returncode, 45, result.stderr)
        self.assertEqual((root / "deployed.base").read_text(), "oldhead\n")
        retried = self.rerun_deploy(root, BUILD_STATUS="0")
        self.assertEqual(retried.returncode, 0, retried.stderr)
        self.assert_all_waited(root)
        diffs = [line for line in (root / "git.log").read_text().splitlines() if line.startswith("diff ")]
        self.assertEqual(diffs, ["diff --name-only --relative oldhead newhead -- ."] * 2)
        self.assertFalse((root / "deployed.base").exists())

    def test_host_lock_rejects_overlap_before_checkout_or_docker(self):
        root, result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        (root / "git.log").write_text("")
        (root / "docker.log").write_text("")
        with (root / "deployed.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            overlapping = self.rerun_deploy(root)
        self.assertNotEqual(overlapping.returncode, 0)
        self.assertIn("Another backend deployment is running.", overlapping.stderr)
        self.assertNotIn("checkout", (root / "git.log").read_text())
        self.assertNotIn("rev-parse HEAD", (root / "git.log").read_text())
        self.assertEqual((root / "docker.log").read_text(), "")
        retried = self.rerun_deploy(root)
        self.assertEqual(retried.returncode, 0, retried.stderr)

    def test_same_ref_recovers_only_missing_or_unhealthy_grafana(self):
        for state in ("missing", "running unhealthy", "exited unhealthy", "running starting"):
            with self.subTest(state=state):
                root, result = self.run_deploy(SAME_REF="1", GRAFANA_STATE=state)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assert_all_waited(root, {"grafana"})
                self.assertEqual((root / ".env").read_text(), INITIAL_ENV)
                calls = (root / "docker.log").read_text().splitlines()
                self.assertIn("compose up -d --no-deps --force-recreate grafana", calls)
                self.assertIn("compose up -d --no-deps --wait --wait-timeout 120 grafana", calls)
                self.assertNotIn("compose up -d --no-deps nginx", calls)
                self.assertNotIn("compose up --abort-on-container-exit --exit-code-from migrate migrate", calls)

    def test_same_ref_recovery_propagates_health_failure(self):
        root, result = self.run_deploy(SAME_REF="1", GRAFANA_STATE="running unhealthy", GRAFANA_HEALTH_STATUS="44")
        self.assertEqual(result.returncode, 44, result.stderr)
        self.assert_all_waited(root, {"grafana"})
        self.assertFalse((root / "start-nginx").exists())
        self.assertNotIn("Deploy complete.", result.stdout)

    def test_same_ref_recovery_still_requires_password(self):
        root, result = self.run_deploy(SAME_REF="1", GRAFANA_STATE="missing", GRAFANA_PASSWORD_STATUS="41")
        self.assertEqual(result.returncode, 41, result.stderr)
        self.assert_no_removals_or_builds(root)
        self.assertIn("Set GRAFANA_ADMIN_PASSWORD", result.stderr)

    def test_same_ref_remains_a_no_op(self):
        root, result = self.run_deploy(SAME_REF="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No new commits. Nothing to deploy.", result.stdout)
        self.assertEqual((root / ".env").read_text(), INITIAL_ENV)
        self.assertEqual((root / "docker.log").read_text().splitlines()[0], "compose ps --all --quiet grafana")
        self.assertFalse(list(root.glob("start-*")))


if __name__ == "__main__":
    unittest.main()
