import json
import subprocess
from dataclasses import dataclass, field
from typing import Optional

from . import config

MARKER = "<!-- harness:addressed -->"

_QUERY = """
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:50){
        nodes{ id isResolved isOutdated path line
          comments(first:20){ nodes{ databaseId body } } }
        pageInfo{ hasNextPage } } } } }
"""


@dataclass
class Thread:
    node_id: str
    comment_id: int
    path: str
    line: Optional[int]
    outdated: bool
    body: str


@dataclass
class ReviewState:
    pending: list = field(default_factory=list)
    unresolved: int = 0
    truncated: bool = False


def parse_threads(payload: dict) -> ReviewState:
    """A thread is pending when it is unresolved and its LAST comment lacks the
    marker, so a human follow-up after an agent reply reopens it. Outdated
    threads still count — they are unresolved feedback."""
    threads = payload["data"]["repository"]["pullRequest"]["reviewThreads"]
    pending, unresolved = [], 0
    for node in threads["nodes"]:
        if node["isResolved"]:
            continue
        unresolved += 1
        comments = node["comments"]["nodes"]
        if not comments or MARKER in (comments[-1]["body"] or ""):
            continue
        pending.append(Thread(
            node_id=node["id"],
            comment_id=comments[0]["databaseId"],
            path=node["path"],
            line=node["line"],
            outdated=node["isOutdated"],
            body="\n\n".join(c["body"] or "" for c in comments),
        ))
    return ReviewState(pending=pending, unresolved=unresolved,
                       truncated=threads["pageInfo"]["hasNextPage"])


def fetch(pr_number: int) -> ReviewState:
    """Thread resolution is GraphQL-only; the REST comments endpoint cannot see
    it. Returns an empty state on error so a transient gh failure is not misread
    as 'no feedback'."""
    owner, name = config.repo_slug().split("/", 1)
    raw = subprocess.run(
        ["gh", "api", "graphql", "-f", f"query={_QUERY}",
         "-F", f"owner={owner}", "-F", f"name={name}", "-F", f"number={pr_number}"],
        capture_output=True, text=True)
    if raw.returncode != 0 or not raw.stdout.strip():
        print(f"[harness] could not read review threads for PR #{pr_number}")
        return ReviewState()
    state = parse_threads(json.loads(raw.stdout))
    if state.truncated:
        print(f"[harness] PR #{pr_number} has more than 50 threads; only the first 50 were read")
    return state


def reply(pr_number: int, thread: Thread, text: str) -> None:
    body = f"{text}\n\n{MARKER}"
    subprocess.run(
        ["gh", "api", f"repos/{config.repo_slug()}/pulls/{pr_number}/comments",
         "-f", f"body={body}", "-F", f"in_reply_to={thread.comment_id}"],
        capture_output=True, text=True, check=True)
