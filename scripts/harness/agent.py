import shlex
import subprocess
import time
from pathlib import Path

from . import notify

SESSION = "agents"
POLL_SECONDS = 2


def _ensure_session() -> None:
    # Idempotent: no-op (fails silently) if the session already exists.
    subprocess.run(["tmux", "new-session", "-d", "-s", SESSION], capture_output=True)


def _window_name(worktree_path: str) -> str:
    return Path(worktree_path).name


def run(worktree_path: str, prompt: str) -> None:
    """Run `opencode run` in its own window inside the shared 'agents' tmux
    session so a human can attach and answer permission prompts (opencode
    auto-rejects them when run headless with no TTY). Blocks until done."""
    _ensure_session()
    window = _window_name(worktree_path)
    status_file = Path(worktree_path) / ".harness-exit-code"
    status_file.unlink(missing_ok=True)
    subprocess.run(["tmux", "kill-window", "-t", f"{SESSION}:{window}"], capture_output=True)
    # -i/--interactive: regular split-footer TUI, not the full-screen textual app,
    # so opencode can actually prompt for permissions instead of auto-rejecting them.
    # After it exits, drop into an interactive shell in the same window instead of
    # letting tmux close it, so the human can still attach and keep working the
    # task by hand (e.g. `opencode run -c -i "..."` to continue the same session)
    # if GitHub review comments alone aren't enough.
    inner = (f"opencode run -i {shlex.quote(prompt)}; "
             f"echo $? > {shlex.quote(str(status_file))}; exec bash")
    subprocess.run(["tmux", "new-window", "-t", SESSION, "-n", window, "-c", worktree_path,
                    "bash", "-lc", inner], check=True)
    notify.desktop("Harness: agent started", f"tmux attach -t {SESSION} (window: {window})")
    print(f"[harness] agent running — tmux attach -t {SESSION}, window '{window}'")
    while not status_file.exists():
        time.sleep(POLL_SECONDS)
    code = int(status_file.read_text().strip())
    if code != 0:
        raise RuntimeError(f"opencode run failed in tmux window '{window}' (exit {code})")


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
