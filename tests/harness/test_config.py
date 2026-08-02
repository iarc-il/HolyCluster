import unittest
from unittest import mock

from scripts.harness import config


class TestRepoSlug(unittest.TestCase):
    def setUp(self):
        config.repo_slug.cache_clear()

    def tearDown(self):
        config.repo_slug.cache_clear()

    def test_returns_name_with_owner(self):
        with mock.patch("scripts.harness.config.subprocess.run") as run:
            run.return_value = mock.Mock(stdout="iarc-il/HolyCluster\n")
            self.assertEqual(config.repo_slug(), "iarc-il/HolyCluster")

    def test_shells_out_only_once(self):
        with mock.patch("scripts.harness.config.subprocess.run") as run:
            run.return_value = mock.Mock(stdout="iarc-il/HolyCluster\n")
            config.repo_slug()
            config.repo_slug()
            self.assertEqual(run.call_count, 1)
