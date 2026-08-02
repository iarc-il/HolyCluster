import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.harness import cli, config, notify
from scripts.harness.lifecycle import GHFacts
from scripts.harness.review import ReviewState, Thread
from scripts.harness.state import PRRecord, load_state, save_state


class TestAddressOutcomes(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.state = self.dir / "state.json"
        self._real_state_path = config.state_path
        self._real_notify = notify.desktop
        config.state_path = lambda: self.state
        notify.desktop = lambda *a, **k: None
        self.rec = PRRecord(task="t", slug="t", branch="agent/t",
                            worktree_path=str(self.dir), phase="ci",
                            id="aaa", pr_number=375)
        save_state(self.state, [self.rec])
        self.facts = GHFacts(
            ci_status="success", new_review=None, merged=False,
            review=ReviewState(pending=[Thread("T1", 1, "a.py", 1, False, "q")],
                               unresolved=1))

    def tearDown(self):
        config.state_path = self._real_state_path
        notify.desktop = self._real_notify

    def _run(self, pushed, writes_replies):
        replies = self.dir / "375.json"

        def fake_agent(worktree, prompt):
            if writes_replies:
                replies.write_text('[{"thread": "T1", "reply": "done"}]')

        with mock.patch("scripts.harness.cli._replies_path", return_value=replies), \
             mock.patch("scripts.harness.cli.agent.run", side_effect=fake_agent), \
             mock.patch("scripts.harness.cli.github.ensure_committed_and_pushed",
                        return_value=pushed), \
             mock.patch("scripts.harness.cli.github.head_sha", return_value="abc1234"), \
             mock.patch("scripts.harness.cli.review.reply") as reply:
            cli._job_address(self.rec, self.facts)
        return load_state(self.state)[0], reply

    def test_diff_and_replies_succeeds(self):
        rec, reply = self._run(pushed=True, writes_replies=True)
        self.assertEqual(rec.phase, "ci")
        self.assertEqual(reply.call_args[0][2], "done")

    def test_diff_without_replies_posts_defaults(self):
        rec, reply = self._run(pushed=True, writes_replies=False)
        self.assertEqual(rec.phase, "ci")
        self.assertIn("abc1234", reply.call_args[0][2])

    def test_replies_without_diff_succeeds(self):
        rec, reply = self._run(pushed=False, writes_replies=True)
        self.assertEqual(rec.phase, "ci")
        self.assertEqual(reply.call_count, 1)

    def test_neither_diff_nor_replies_blocks(self):
        rec, reply = self._run(pushed=False, writes_replies=False)
        self.assertEqual(rec.phase, "blocked")
        self.assertIn("neither", rec.blocked_reason)
        reply.assert_not_called()

    def test_ci_fix_attempts_reset_on_success(self):
        self.rec.ci_fix_attempts = 2
        save_state(self.state, [self.rec])
        rec, _ = self._run(pushed=True, writes_replies=True)
        self.assertEqual(rec.ci_fix_attempts, 0)
