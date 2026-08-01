import json
import subprocess
from pathlib import Path
from typing import Optional

from .config import BASE_BRANCH, REVIEWER, worktree_parent
from .lifecycle import GHFacts, Review


def _run(args, cwd=None) -> str:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                          check=True).stdout.strip()


def ci_summary(pr_number: int) -> str:
    # `gh pr checks` exits NON-ZERO when checks are failing/pending — i.e. exactly
    # when FIX_CI needs it — so capture output WITHOUT check=True. Using _run here
    # would raise precisely when CI is red and self-block the fix job.
    return subprocess.run(["gh", "pr", "checks", str(pr_number)],
                          capture_output=True, text=True).stdout.strip()


def _ref_exists(ref: str) -> bool:
    return subprocess.run(["git", "rev-parse", "--verify", "--quiet", ref],
                          capture_output=True).returncode == 0


def create_worktree(slug: str, branch: str) -> str:
    """Attach a worktree to `branch`, reusing it if it already exists. A restart
    after the worktree was removed must not fail on `add -b` and orphan a branch
    that may already be pushed with an open PR."""
    path = str(worktree_parent() / slug)
    _run(["git", "fetch", "origin", BASE_BRANCH])
    subprocess.run(["git", "fetch", "origin", branch], capture_output=True)
    if _ref_exists(f"refs/heads/{branch}"):
        _run(["git", "worktree", "add", path, branch])
    elif _ref_exists(f"refs/remotes/origin/{branch}"):
        _run(["git", "worktree", "add", "-b", branch, path, f"origin/{branch}"])
    else:
        _run(["git", "worktree", "add", "-b", branch, path, f"origin/{BASE_BRANCH}"])
    return path


def remove_worktree(worktree_path: str, branch: str) -> None:
    # Close the task's tmux window first (kills any lingering shell/agent that is
    # cwd'd in the worktree), then remove the worktree, branch, and prune.
    # An empty path means no worktree was ever created — skip straight to the
    # branch cleanup rather than letting tmux/git act on an empty target.
    if worktree_path:
        from .agent import SESSION
        window = Path(worktree_path).name
        subprocess.run(["tmux", "kill-window", "-t", f"{SESSION}:{window}"], capture_output=True)
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
    # Use statusCheckRollup via `gh pr view` (exits 0). `gh pr checks --json` exits
    # NON-ZERO and prints nothing when CI is red/pending, which made a failing CI
    # misread as "none" so FIX_CI never dispatched.
    raw = subprocess.run(["gh", "pr", "view", str(pr_number), "--json", "statusCheckRollup"],
                         capture_output=True, text=True)
    if raw.returncode != 0 or not raw.stdout.strip():
        return "none"
    checks = json.loads(raw.stdout).get("statusCheckRollup") or []
    if not checks:
        return "none"

    def one(c):
        if c.get("__typename") == "CheckRun":
            if c.get("status") != "COMPLETED":
                return "pending"
            return "success" if c.get("conclusion") in ("SUCCESS", "NEUTRAL", "SKIPPED") else "failure"
        state = c.get("state")  # legacy StatusContext
        if state == "SUCCESS":
            return "success"
        if state in ("PENDING", "EXPECTED"):
            return "pending"
        return "failure"

    statuses = [one(c) for c in checks]
    if any(s == "failure" for s in statuses):
        return "failure"
    if any(s == "pending" for s in statuses):
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
    # Use the REST API, which returns a numeric review `id`. `gh pr view --json
    # reviews` returns a GraphQL node-id STRING (e.g. "PRR_kwDO...") that int()
    # cannot parse. Consistent with _inline_comments, which also uses REST.
    raw = _run(["gh", "api", f"repos/{_repo_slug()}/pulls/{pr_number}/reviews"])
    reviews = json.loads(raw) if raw else []
    actionable = [
        r for r in reviews
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
    # Self-ASSIGN, not request-review: GitHub forbids requesting a review from the
    # PR author, and the harness opens PRs as REVIEWER itself. Assigning puts the
    # PR in the human's "Assigned" queue as the ready-for-review signal.
    subprocess.run(["gh", "pr", "edit", str(pr_number),
                    "--add-assignee", REVIEWER])
