import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "deploy_ui.sh"


class DeployUiTests(unittest.TestCase):
    def test_retains_assets_for_open_clients(self):
        self.deploy()

    def test_does_not_publish_index_after_asset_upload_failure(self):
        self.deploy(fail_assets=True)

    def deploy(self, fail_assets=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "ui/dist"
            target = root / "site"
            binary = root / "bin"
            for directory in (source / "assets", target / "assets", binary):
                directory.mkdir(parents=True)
            (source / "index.html").write_text("new index")
            (source / "assets/current.js").write_text("current module")
            (target / "index.html").write_text("previous index")
            old = target / "assets/old.js"
            old.write_text("old module")
            os.utime(old, (time.time() - 30 * 86400,) * 2)
            (binary / "rsync").write_text(
                "#!/usr/bin/env python3\n"
                "import os, sys\n"
                "args = [arg.removeprefix('user@host:') for arg in sys.argv[1:]]\n"
                "if os.environ.get('FAIL_ASSETS') and args[-2].endswith('/assets/'):\n"
                "    sys.exit(23)\n"
                f"os.execv({shutil.which('rsync')!r}, ['rsync', *args])\n"
            )
            (binary / "ssh").write_text('#!/bin/sh\nshift\nexec bash -c "$*"\n')
            for executable in binary.iterdir():
                executable.chmod(0o755)
            result = subprocess.run(
                ["bash", str(SCRIPT), "user", "host", str(target)],
                cwd=root,
                env={**os.environ, "PATH": f"{binary}:{os.environ['PATH']}",
                     "FAIL_ASSETS": "1" if fail_assets else ""},
                capture_output=True,
                text=True,
            )
            if fail_assets:
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual((target / "index.html").read_text(), "previous index")
            else:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((target / "index.html").read_text(), "new index")
                self.assertTrue((target / "assets/current.js").exists())
                self.assertTrue(old.exists(), "An open client can still reference this asset")


if __name__ == "__main__":
    unittest.main()
