import shlex
import subprocess
import time
from pathlib import Path

from . import notify

POLL_SECONDS = 2


def _session_name(worktree_path: str) -> str:
    return f"harness-{Path(worktree_path).name}"


def _session_alive(session: str) -> bool:
    return subprocess.run(["tmux", "has-session", "-t", session],
                          capture_output=True).returncode == 0


def run(worktree_path: str, prompt: str) -> None:
    """Run `opencode run` inside a dedicated, detached tmux session so a human
    can attach and answer permission prompts (opencode auto-rejects them when
    run headless with no TTY). Blocks until the session exits."""
    session = _session_name(worktree_path)
    status_file = Path(worktree_path) / ".harness-exit-code"
    status_file.unlink(missing_ok=True)
    subprocess.run(["tmux", "kill-session", "-t", session], capture_output=True)
    inner = f"opencode run {shlex.quote(prompt)}; echo $? > {shlex.quote(str(status_file))}"
    subprocess.run(["tmux", "new-session", "-d", "-s", session, "-c", worktree_path,
                    "bash", "-lc", inner], check=True)
    notify.desktop("Harness: agent started", f"tmux attach -t {session}")
    print(f"[harness] agent running — attach with: tmux attach -t {session}")
    while _session_alive(session):
        time.sleep(POLL_SECONDS)
    code = int(status_file.read_text().strip()) if status_file.exists() else 1
    if code != 0:
        raise RuntimeError(f"opencode run failed in tmux session '{session}' (exit {code})")


def IMPLEMENT_TMPL(task: str) -> str:
    return (
        f"Implement the following task fully and correctly in this repository. "
        f"Follow existing code conventions and add or update tests. "
        f"Do NOT commit, push, or open a PR — just make the code changes.\n\n"
        f"TASK: {task}"
    )


def FIX_CI_TMPL(logs: str) -> str:
    return (
        f"CI is failing on this branch. Diagnose and fix the root cause so all "
        f"checks pass. Do NOT commit or push — just fix the code.\n\n"
        f"FAILING CI LOG (truncated):\n{logs}"
    )


def ADDRESS_TMPL(review_text: str) -> str:
    return (
        f"A human reviewer left the following feedback on this PR. Address every "
        f"point by changing the code. Do NOT commit, push, or resolve threads.\n\n"
        f"REVIEW FEEDBACK:\n{review_text}"
    )
