import subprocess
from pathlib import Path

BASE_BRANCH = "dev"
BRANCH_PREFIX = "agent/"
MAX_CONCURRENT = 3
MAX_CI_FIX_ATTEMPTS = 3
POLL_INTERVAL_SECONDS = 45
REVIEWER = "doctoromer"


def repo_root() -> Path:
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return Path(out)


def worktree_parent() -> Path:
    return repo_root().parent


def state_path() -> Path:
    return repo_root() / ".harness" / "state.json"
