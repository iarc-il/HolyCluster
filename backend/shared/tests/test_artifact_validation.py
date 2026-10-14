import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from shared.artifact_validation import validate_package
from shared.release_manifest import ReleaseManifestError

FIXTURES = Path(__file__).resolve().parents[1] / "artifact-validator/fixtures"


class ArtifactValidationTest(unittest.TestCase):
    def test_valid_packages(self):
        for platform, name in (("windows", "valid-windows.msi"), ("linux", "valid-linux.AppImage")):
            with self.subTest(platform=platform):
                validate_package(FIXTURES / name, platform, "x86_64", "catserver-v1.2.3")

    def test_appimage_cannot_be_declared_windows(self):
        with self.assertRaises(ReleaseManifestError):
            validate_package(FIXTURES / "valid-linux.AppImage", "windows", "x86_64", "catserver-v1.2.3")

    def test_unknown_architecture_is_rejected(self):
        with self.assertRaises(ReleaseManifestError):
            validate_package(FIXTURES / "valid-windows.msi", "windows", "aarch64", "catserver-v1.2.3")

    def test_missing_inspector_fails_closed(self):
        with patch.dict("os.environ", {"HOLY_ARTIFACT_VALIDATOR": "/missing/validator"}):
            with self.assertRaisesRegex(ReleaseManifestError, "validator is unavailable"):
                validate_package(FIXTURES / "valid-windows.msi", "windows", "x86_64", "catserver-v1.2.3")

    def test_inspection_timeout_fails_closed(self):
        with patch("shared.artifact_validation.shutil.which", return_value="/inspector"):
            with patch(
                "shared.artifact_validation.subprocess.run", side_effect=subprocess.TimeoutExpired("inspector", 60)
            ):
                with self.assertRaisesRegex(ReleaseManifestError, "inspection failed"):
                    validate_package(FIXTURES / "valid-windows.msi", "windows", "x86_64", "catserver-v1.2.3")
