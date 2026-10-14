"""Keep build and publish version selection consistent after checkout rewrites a tag."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/catserver.yml"


class ReleaseVersionTests(unittest.TestCase):
    def test_tagged_and_development_versions_match_in_all_jobs(self):
        workflow = WORKFLOW.read_text()
        self.assertIn(
            "CATSERVER_VERSION: ${{ github.ref_type == 'tag' && github.ref_name || '' }}",
            workflow,
        )
        selectors = [
            line.strip()
            for line in workflow.splitlines()
            if line.strip().startswith(('echo "CATSERVER_VERSION=', 'VERSION='))
        ]
        self.assertEqual(len(selectors), 6)
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(
                    ["git", "-C", directory, *args], text=True
                ).strip()

            git("init", "-q")
            git("config", "user.name", "Release test")
            git("config", "user.email", "release-test@example.invalid")
            git("commit", "--allow-empty", "-qm", "previous release")
            git("tag", "-a", "catserver-v1.3.0", "-m", "previous release")
            git("commit", "--allow-empty", "-qm", "new release")
            git("tag", "-a", "catserver-v1.3.1", "-m", "new release")
            # Reproduce actions/checkout fetching the peeled commit into the tag ref.
            git("update-ref", "refs/tags/catserver-v1.3.1", git("rev-parse", "HEAD"))
            fallback = git("describe", "--match", "catserver-v*")
            self.assertTrue(fallback.startswith("catserver-v1.3.0-1-g"))
            env_file = Path(directory) / "env"
            for selector in selectors:
                cases = [("catserver-v1.3.1", "catserver-v1.3.1"), ("", fallback)]
                for version, expected in cases:
                    with self.subTest(selector=selector, version=version):
                        env_file.write_text("")
                        environment = dict(
                            os.environ,
                            CATSERVER_VERSION=version,
                            GITHUB_ENV=str(env_file),
                        )
                        script = selector
                        if selector.startswith("VERSION="):
                            script += '\nprintf "%s" "$VERSION"'
                        output = subprocess.check_output(
                            ["bash", "-e", "-c", script],
                            cwd=directory,
                            env=environment,
                            text=True,
                        )
                        actual = (
                            output
                            if selector.startswith("VERSION=")
                            else env_file.read_text().strip().split("=", 1)[1]
                        )
                        self.assertEqual(actual, expected)

    def test_build_script_uses_git_for_unset_or_empty_override(self):
        source = (WORKFLOW.parents[2] / "catserver/build.rs").read_text()
        version_functions = source[
            source.index("fn release_version()") : source.index("fn compile_windows_resource(")
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            helper = root / "version.rs"
            helper.write_text(
                "use std::{env, process::Command};\n"
                + version_functions
                + '\nfn main() { println!("RESULT={}", release_version()); }\n'
            )
            executable = root / "version"
            subprocess.run(
                ["rustc", "--edition=2024", str(helper), "-o", str(executable)],
                check=True,
            )
            subprocess.run(["git", "init", "-q", directory], check=True)
            subprocess.run(
                ["git", "-C", directory, "-c", "user.name=Test", "-c",
                 "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "test"],
                check=True,
            )
            subprocess.run(
                ["git", "-C", directory, "-c", "user.name=Test", "-c",
                 "user.email=test@example.invalid", "tag", "-a", "catserver-v1.3.0", "-m", "test"],
                check=True,
            )
            for override, expected in [
                (None, "catserver-v1.3.0"),
                ("", "catserver-v1.3.0"),
                ("catserver-v1.3.1", "catserver-v1.3.1"),
                ("invalid", None),
            ]:
                with self.subTest(override=override):
                    environment = os.environ.copy()
                    environment.pop("CATSERVER_VERSION", None)
                    if override is not None:
                        environment["CATSERVER_VERSION"] = override
                    result = subprocess.run(
                        [str(executable)], cwd=directory, env=environment,
                        text=True, capture_output=True,
                    )
                    if expected is None:
                        self.assertNotEqual(result.returncode, 0)
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertIn("RESULT=" + expected, result.stdout)


if __name__ == "__main__":
    unittest.main()
