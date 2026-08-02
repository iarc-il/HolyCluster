import json
import unittest
from unittest import mock

from scripts.harness import github


class TestActionableReview(unittest.TestCase):
    def _reviews(self, *entries):
        return mock.patch("scripts.harness.github._run",
                          return_value=json.dumps(list(entries)))

    def test_blank_body_container_review_is_ignored(self):
        # GitHub creates one of these for every inline comment.
        with self._reviews({"id": 4835626447, "state": "COMMENTED", "body": ""}):
            self.assertIsNone(github._latest_actionable_review(375, None))

    def test_whitespace_body_is_ignored(self):
        with self._reviews({"id": 1, "state": "COMMENTED", "body": "   \n "}):
            self.assertIsNone(github._latest_actionable_review(375, None))

    def test_real_summary_body_is_actionable(self):
        with self._reviews({"id": 7, "state": "CHANGES_REQUESTED", "body": "rename X"}):
            r = github._latest_actionable_review(375, None)
        self.assertEqual(r.id, 7)
        self.assertEqual(r.text, "rename X")

    def test_body_at_or_below_watermark_is_ignored(self):
        with self._reviews({"id": 7, "state": "COMMENTED", "body": "old"}):
            self.assertIsNone(github._latest_actionable_review(375, 7))

    def test_newest_actionable_body_wins(self):
        with self._reviews({"id": 3, "state": "COMMENTED", "body": "older"},
                           {"id": 9, "state": "COMMENTED", "body": "newer"}):
            r = github._latest_actionable_review(375, None)
        self.assertEqual(r.id, 9)
