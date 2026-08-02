import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.harness import cli
from scripts.harness.review import Thread


def thread(node_id):
    return Thread(node_id=node_id, comment_id=1, path="a.py", line=1,
                  outdated=False, body="q")


class TestPostReplies(unittest.TestCase):
    def setUp(self):
        self.path = Path(tempfile.mkdtemp()) / "375.json"

    def test_agent_reply_is_posted_verbatim(self):
        self.path.write_text(json.dumps([{"thread": "T1", "reply": "Now lazy."}]))
        with mock.patch("scripts.harness.cli.review.reply") as reply:
            cli._post_replies(375, [thread("T1")], self.path, "abc1234")
        reply.assert_called_once()
        self.assertEqual(reply.call_args[0][2], "Now lazy.")

    def test_uncovered_thread_gets_a_default_reply(self):
        self.path.write_text(json.dumps([{"thread": "T1", "reply": "Now lazy."}]))
        with mock.patch("scripts.harness.cli.review.reply") as reply:
            cli._post_replies(375, [thread("T1"), thread("T2")], self.path, "abc1234")
        self.assertEqual(reply.call_count, 2)
        self.assertIn("abc1234", reply.call_args_list[1][0][2])

    def test_missing_file_still_replies_to_every_thread(self):
        with mock.patch("scripts.harness.cli.review.reply") as reply:
            cli._post_replies(375, [thread("T1"), thread("T2")], self.path, "abc1234")
        self.assertEqual(reply.call_count, 2)

    def test_malformed_file_does_not_raise_and_still_replies(self):
        self.path.write_text("{not json")
        with mock.patch("scripts.harness.cli.review.reply") as reply:
            cli._post_replies(375, [thread("T1")], self.path, "abc1234")
        self.assertEqual(reply.call_count, 1)

    def test_replies_file_is_deleted_afterwards(self):
        self.path.write_text(json.dumps([{"thread": "T1", "reply": "x"}]))
        with mock.patch("scripts.harness.cli.review.reply"):
            cli._post_replies(375, [thread("T1")], self.path, "abc1234")
        self.assertFalse(self.path.exists())

    def test_empty_reply_text_falls_back_to_default(self):
        self.path.write_text(json.dumps([{"thread": "T1", "reply": ""}]))
        with mock.patch("scripts.harness.cli.review.reply") as reply:
            cli._post_replies(375, [thread("T1")], self.path, "abc1234")
        self.assertIn("abc1234", reply.call_args[0][2])
