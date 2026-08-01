import subprocess
from pathlib import Path

BASE_BRANCH = "dev"
BRANCH_PREFIX = "agent/"
MAX_CONCURRENT = 3
MAX_CI_FIX_ATTEMPTS = 3
NO_CHECK_GRACE_POLLS = 2
POLL_INTERVAL_SECONDS = 45
REVIEWER = "doctoromer"


def repo_root() -> Path:
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return Path(out)


def main_repo_root() -> Path:
    # Resolves to the primary checkout's root even when invoked from inside one
    # of the harness's own task worktrees, since --git-common-dir always points
    # at the one shared .git directory.
    common_dir = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return Path(common_dir).parent


def worktree_parent() -> Path:
    return main_repo_root() / ".worktrees"


def state_path() -> Path:
    return main_repo_root() / ".harness" / "state.json"
