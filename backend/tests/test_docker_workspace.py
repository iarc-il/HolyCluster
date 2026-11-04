import unittest
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
WORKSPACE_MEMBERS = ("api", "collectors", "coverage", "shared")
DOCKERFILES = tuple((BACKEND / "docker").glob("Dockerfile.*"))


class DockerWorkspaceTests(unittest.TestCase):
    def test_images_include_every_workspace_member(self):
        for dockerfile in DOCKERFILES:
            contents = dockerfile.read_text()
            with self.subTest(dockerfile=dockerfile.name):
                for member in WORKSPACE_MEMBERS:
                    self.assertIn(f"source={member}/pyproject.toml", contents)
                    self.assertIn(f"COPY {member}/", contents)

    def test_coverage_reader_reuses_existing_database_secret(self):
        compose = (BACKEND / "docker-compose.yml").read_text()
        self.assertNotIn("${GRAFANA_POSTGRES_", compose)
        self.assertEqual(compose.count("GRAFANA_POSTGRES_USER: grafana_coverage"), 2)
        self.assertEqual(compose.count("GRAFANA_POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-}"), 2)
