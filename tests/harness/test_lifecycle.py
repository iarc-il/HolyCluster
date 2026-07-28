import unittest

from scripts.harness.state import PRRecord
from scripts.harness.lifecycle import Action, GHFacts, Review, decide


def rec(phase="ci", pr_number=10, attempts=0, last_review=None):
    return PRRecord(task="t", slug="t", branch="agent/t", worktree_path="/x",
                    phase=phase, pr_number=pr_number, ci_fix_attempts=attempts,
                    last_handled_review_id=last_review)


def facts(ci="pending", review=None, merged=False):
    return GHFacts(ci_status=ci, new_review=review, merged=merged)


class TestLifecycle(unittest.TestCase):
    def test_merged_always_wins_even_with_pending_ci(self):
        self.assertEqual(decide(rec(), facts(ci="pending", merged=True)), Action.CLEANUP)

    def test_blocked_record_does_nothing(self):
        self.assertEqual(decide(rec(phase="blocked"), facts(ci="failure")), Action.NONE)

    def test_queued_triggers_implement(self):
        self.assertEqual(decide(rec(phase="queued", pr_number=None), facts(ci="none")), Action.IMPLEMENT)

    def test_implement_in_flight_no_pr_is_noop(self):
        self.assertEqual(decide(rec(phase="implementing", pr_number=None), facts(ci="none")), Action.NONE)

    def test_new_review_beats_green_ci(self):
        review = Review(id=5, state="CHANGES_REQUESTED", text="fix X")
        self.assertEqual(decide(rec(phase="await_review"), facts(ci="success", review=review)), Action.ADDRESS_REVIEW)

    def test_ci_failure_under_cap_triggers_fix(self):
        self.assertEqual(decide(rec(attempts=2), facts(ci="failure")), Action.FIX_CI)

    def test_ci_failure_at_cap_blocks(self):
        self.assertEqual(decide(rec(attempts=3), facts(ci="failure")), Action.BLOCK)

    def test_green_ci_requests_review_once(self):
        self.assertEqual(decide(rec(phase="ci"), facts(ci="success")), Action.REQUEST_REVIEW)

    def test_green_ci_already_awaiting_is_noop(self):
        self.assertEqual(decide(rec(phase="await_review"), facts(ci="success")), Action.NONE)

    def test_pending_ci_is_noop(self):
        self.assertEqual(decide(rec(phase="ci"), facts(ci="pending")), Action.NONE)


if __name__ == "__main__":
    unittest.main()
