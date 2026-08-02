import json
import unittest
from unittest import mock

from scripts.harness import review
from scripts.harness.review import MARKER, parse_threads


def payload(*threads, has_next=False):
    return {"data": {"repository": {"pullRequest": {"reviewThreads": {
        "nodes": list(threads), "pageInfo": {"hasNextPage": has_next}}}}}}


def thread(comments, resolved=False, outdated=False, tid="T1", path="a.py", line=3):
    return {"id": tid, "isResolved": resolved, "isOutdated": outdated,
            "path": path, "line": line,
            "comments": {"nodes": [{"databaseId": 100 + i, "body": b}
                                   for i, b in enumerate(comments)]}}


class TestPendingRule(unittest.TestCase):
    def test_unanswered_thread_is_pending(self):
        state = parse_threads(payload(thread(["why fetch at start?"])))
        self.assertEqual(len(state.pending), 1)
        self.assertEqual(state.unresolved, 1)

    def test_thread_answered_by_agent_is_not_pending(self):
        state = parse_threads(payload(thread(["why?", f"because X\n\n{MARKER}"])))
        self.assertEqual(state.pending, [])
        self.assertEqual(state.unresolved, 1)

    def test_human_followup_after_agent_reopens_thread(self):
        state = parse_threads(payload(
            thread(["why?", f"because X\n\n{MARKER}", "still wrong on line 40"])))
        self.assertEqual(len(state.pending), 1)

    def test_resolved_thread_is_ignored_entirely(self):
        state = parse_threads(payload(thread(["why?"], resolved=True)))
        self.assertEqual(state.pending, [])
        self.assertEqual(state.unresolved, 0)

    def test_outdated_thread_is_still_pending(self):
        state = parse_threads(payload(thread(["why?"], outdated=True)))
        self.assertEqual(len(state.pending), 1)
        self.assertTrue(state.pending[0].outdated)

    def test_thread_fields_are_captured(self):
        state = parse_threads(payload(
            thread(["first", "second"], tid="T9", path="backend/x.py", line=42)))
        t = state.pending[0]
        self.assertEqual(t.node_id, "T9")
        self.assertEqual(t.comment_id, 100)
        self.assertEqual(t.path, "backend/x.py")
        self.assertEqual(t.line, 42)
        self.assertIn("first", t.body)
        self.assertIn("second", t.body)

    def test_truncation_is_reported(self):
        self.assertTrue(parse_threads(payload(has_next=True)).truncated)
        self.assertFalse(parse_threads(payload()).truncated)

    def test_empty_thread_is_not_pending(self):
        state = parse_threads(payload(thread([])))
        self.assertEqual(state.pending, [])
        self.assertEqual(state.unresolved, 1)


class TestFetchAndReply(unittest.TestCase):
    def test_fetch_parses_a_graphql_response(self):
        body = json.dumps(payload(thread(["why?"])))
        with mock.patch("scripts.harness.review.config.repo_slug",
                        return_value="iarc-il/HolyCluster"), \
             mock.patch("scripts.harness.review.subprocess.run") as run:
            run.return_value = mock.Mock(returncode=0, stdout=body)
            state = review.fetch(375)
        self.assertEqual(len(state.pending), 1)
        args = run.call_args[0][0]
        self.assertIn("graphql", args)
        self.assertIn("number=375", args)

    def test_fetch_returns_empty_state_on_error(self):
        with mock.patch("scripts.harness.review.config.repo_slug",
                        return_value="iarc-il/HolyCluster"), \
             mock.patch("scripts.harness.review.subprocess.run") as run:
            run.return_value = mock.Mock(returncode=1, stdout="")
            state = review.fetch(375)
        self.assertEqual(state.pending, [])
        self.assertEqual(state.unresolved, 0)

    def test_reply_appends_the_marker_and_targets_the_thread(self):
        t = review.Thread(node_id="T1", comment_id=555, path="a.py",
                          line=1, outdated=False, body="q")
        with mock.patch("scripts.harness.review.config.repo_slug",
                        return_value="iarc-il/HolyCluster"), \
             mock.patch("scripts.harness.review.subprocess.run") as run:
            run.return_value = mock.Mock(returncode=0, stdout="")
            review.reply(375, t, "Fixed it")
        args = run.call_args[0][0]
        self.assertIn("repos/iarc-il/HolyCluster/pulls/375/comments", args)
        self.assertIn("in_reply_to=555", args)
        body_arg = [a for a in args if a.startswith("body=")][0]
        self.assertIn("Fixed it", body_arg)
        self.assertIn(MARKER, body_arg)
