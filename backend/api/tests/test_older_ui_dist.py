import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

# Imported in a fresh interpreter because the static mounts are built at import time
CHECK_SCRIPT = textwrap.dedent(
    """
    from fastapi.testclient import TestClient

    from api.main import app

    client = TestClient(app)
    print(client.get("/manifest.webmanifest").status_code)
    print(client.get("/icons/holycluster-192.png").status_code)
    print(client.get("/").status_code)
    """
)


class OlderUiDistTest(unittest.TestCase):
    def test_api_starts_with_a_ui_build_that_has_no_pwa_files(self):
        with tempfile.TemporaryDirectory() as directory:
            ui_dist = Path(directory)
            (ui_dist / "assets").mkdir()
            (ui_dist / "index.html").write_text("<!doctype html>")

            result = subprocess.run(
                [sys.executable, "-c", CHECK_SCRIPT],
                env={**os.environ, "UI_DIST_PATH": str(ui_dist)},
                capture_output=True,
                text=True,
                timeout=120,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.split(), ["404", "404", "200"])
