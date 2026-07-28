import json
import subprocess
from pathlib import Path
from typing import Optional

from .config import BASE_BRANCH, REVIEWER, worktree_parent
from .lifecycle import GHFacts, Review


def _run(args, cwd=None) -> str:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                          check=True).stdout.strip()


def create_worktree(slug: str, branch: str) -> str:
    path = str(worktree_parent() / f"HolyCluster-{slug}")
    _run(["git", "fetch", "origin", BASE_BRANCH])
    _run(["git", "worktree", "add", "-b", branch, path, f"origin/{BASE_BRANCH}"])
    return path


def remove_worktree(worktree_path: str, branch: str) -> None:
    subprocess.run(["git", "worktree", "remove", "--force", worktree_path])
    subprocess.run(["git", "branch", "-D", branch])
    subprocess.run(["git", "worktree", "prune"])


def commit_and_push(worktree_path: str, branch: str, message: str) -> bool:
    _run(["git", "add", "-A"], cwd=worktree_path)
    status = _run(["git", "status", "--porcelain"], cwd=worktree_path)
    if not status:
        return False
    _run(["git", "commit", "-m", message], cwd=worktree_path)
    _run(["git", "push", "-u", "origin", branch], cwd=worktree_path)
    return True


def open_pr(worktree_path: str, branch: str, title: str, body: str) -> int:
    _run(["gh", "pr", "create", "--base", BASE_BRANCH, "--head", branch,
          "--title", title, "--body", body], cwd=worktree_path)
    num = _run(["gh", "pr", "view", branch, "--json", "number",
                "--jq", ".number"], cwd=worktree_path)
    return int(num)


def has_uncommitted_changes(worktree_path: str) -> bool:
    return bool(_run(["git", "status", "--porcelain"], cwd=worktree_path))


def find_existing_pr(branch: str) -> Optional[int]:
    """PR number for `branch` if one already exists (any state), else None."""
    raw = subprocess.run(["gh", "pr", "view", branch, "--json", "number", "--jq", ".number"],
                         capture_output=True, text=True)
    if raw.returncode != 0 or not raw.stdout.strip():
        return None
    return int(raw.stdout.strip())


def ensure_committed_and_pushed(worktree_path: str, branch: str, message: str) -> bool:
    """Idempotent version of commit_and_push: safe to call no matter how far a
    previous, interrupted attempt already got. Commits pending changes if any,
    then pushes if the branch is ahead of BASE_BRANCH. Returns whether there is
    anything on the branch worth a PR for."""
    _run(["git", "add", "-A"], cwd=worktree_path)
    if _run(["git", "status", "--porcelain"], cwd=worktree_path):
        _run(["git", "commit", "-m", message], cwd=worktree_path)
    ahead = _run(["git", "rev-list", "--count", f"origin/{BASE_BRANCH}..HEAD"], cwd=worktree_path)
    if ahead == "0":
        return False
    _run(["git", "push", "-u", "origin", branch], cwd=worktree_path)
    return True


def _ci_status(pr_number: int) -> str:
    raw = subprocess.run(
        ["gh", "pr", "checks", str(pr_number), "--json", "state"],
        capture_output=True, text=True,
    )
    if raw.returncode != 0 or not raw.stdout.strip():
        return "none"
    states = [c["state"] for c in json.loads(raw.stdout)]
    if not states:
        return "none"
    if any(s in ("FAILURE", "ERROR", "CANCELLED", "TIMED_OUT") for s in states):
        return "failure"
    if any(s in ("PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED") for s in states):
        return "pending"
    return "success"


def _repo_slug() -> str:
    # e.g. "iarc-il/HolyCluster" — avoids relying on gh's {owner}/{repo} templating
    return _run(["gh", "repo", "view", "--json", "nameWithOwner",
                 "--jq", ".nameWithOwner"])


def _inline_comments(pr_number: int) -> str:
    # Inline (line-level) review comments are not in `gh pr view --json reviews`;
    # fetch them via the REST API. Fall back to "" (review summary only) on error.
    try:
        raw = _run(["gh", "api",
                    f"repos/{_repo_slug()}/pulls/{pr_number}/comments"])
        return "\n".join(c["body"] for c in json.loads(raw)) if raw else ""
    except subprocess.CalledProcessError:
        return ""


def _latest_actionable_review(pr_number: int, last_id: Optional[int]) -> Optional[Review]:
    data = json.loads(_run(["gh", "pr", "view", str(pr_number),
                            "--json", "reviews"]))
    actionable = [
        r for r in data["reviews"]
        if r.get("state") in ("CHANGES_REQUESTED", "COMMENTED")
        and int(r["id"]) > (last_id or 0)
    ]
    if not actionable:
        return None
    r = max(actionable, key=lambda x: int(x["id"]))
    text = ((r.get("body") or "") + "\n" + _inline_comments(pr_number)).strip()
    return Review(id=int(r["id"]), state=r["state"], text=text)


def fetch_facts(pr_number: int, last_handled_review_id: Optional[int]) -> GHFacts:
    merged = _run(["gh", "pr", "view", str(pr_number), "--json", "state",
                   "--jq", ".state"]) == "MERGED"
    if merged:
        return GHFacts(ci_status="none", new_review=None, merged=True)
    return GHFacts(
        ci_status=_ci_status(pr_number),
        new_review=_latest_actionable_review(pr_number, last_handled_review_id),
        merged=False,
    )


def rerequest_review(pr_number: int) -> None:
    subprocess.run(["gh", "pr", "edit", str(pr_number),
                    "--add-reviewer", REVIEWER])
