import unittest

from scripts.harness import agent
from scripts.harness.review import Thread


def thread(body="why fetch at start?", outdated=False, path="backend/x.py", line=12):
    return Thread(node_id="T1", comment_id=100, path=path, line=line,
                  outdated=outdated, body=body)


class TestAddressPrompt(unittest.TestCase):
    def test_prompt_names_the_replies_file(self):
        p = agent.ADDRESS_TMPL([thread()], "/repo/.harness/replies/375.json", "")
        self.assertIn("/repo/.harness/replies/375.json", p)

    def test_prompt_includes_thread_id_location_and_text(self):
        p = agent.ADDRESS_TMPL([thread()], "/x.json", "")
        self.assertIn("T1", p)
        self.assertIn("backend/x.py", p)
        self.assertIn("12", p)
        self.assertIn("why fetch at start?", p)

    def test_outdated_thread_is_flagged(self):
        p = agent.ADDRESS_TMPL([thread(outdated=True)], "/x.json", "")
        self.assertIn("outdated", p.lower())

    def test_current_thread_is_not_flagged_outdated(self):
        p = agent.ADDRESS_TMPL([thread(outdated=False)], "/x.json", "")
        self.assertNotIn("outdated", p.lower())

    def test_summary_body_is_included_when_present(self):
        p = agent.ADDRESS_TMPL([], "/x.json", "please rename X")
        self.assertIn("please rename X", p)

    def test_agent_is_told_not_to_commit_or_resolve(self):
        p = agent.ADDRESS_TMPL([thread()], "/x.json", "")
        self.assertIn("commit", p.lower())
        self.assertIn("resolve", p.lower())
