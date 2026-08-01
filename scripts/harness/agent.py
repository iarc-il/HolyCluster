import shlex
import subprocess
import time
from pathlib import Path

from . import config, notify

SESSION = "agents"
POLL_SECONDS = 2


def _ensure_session() -> None:
    # Idempotent: no-op (fails silently) if the session already exists.
    subprocess.run(["tmux", "new-session", "-d", "-s", SESSION], capture_output=True)


def _window_name(worktree_path: str) -> str:
    return Path(worktree_path).name


def _status_file(worktree_path: str) -> Path:
    return config.main_repo_root() / ".harness" / "exit-codes" / f"{_window_name(worktree_path)}.code"


def window_alive(worktree_path: str) -> bool:
    """True if this task's tmux window still exists. NOTE: the window lingers open
    (interactive shell via `exec bash`) AFTER opencode exits, so this alone is NOT
    a 'still working' signal — use is_running() for that."""
    r = subprocess.run(["tmux", "list-windows", "-t", SESSION, "-F", "#{window_name}"],
                       capture_output=True, text=True)
    return r.returncode == 0 and _window_name(worktree_path) in r.stdout.split()


def is_running(worktree_path: str) -> bool:
    """True only while the agent is actively working: its window exists AND it has
    not yet written its exit-code marker. The marker (written the instant opencode
    exits, before the shell lingers) is the real completion signal."""
    return window_alive(worktree_path) and not _status_file(worktree_path).exists()


def wait_for(worktree_path: str) -> None:
    """Block until the agent already running in this task's window finishes
    (marker appears) or the window is gone."""
    while is_running(worktree_path):
        time.sleep(POLL_SECONDS)


def run(worktree_path: str, prompt: str) -> None:
    """Run `opencode run` in its own window inside the shared 'agents' tmux
    session so a human can attach and answer permission prompts (opencode
    auto-rejects them when run headless with no TTY). Blocks until done."""
    _ensure_session()
    window = _window_name(worktree_path)
    # Marker lives OUTSIDE the worktree (gitignored .harness/) so `git add -A`
    # can never sweep it into a commit/PR. It is also the completion signal.
    status_file = _status_file(worktree_path)
    status_file.parent.mkdir(parents=True, exist_ok=True)
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
    # Wait on the marker, but give up if the window disappears (human closed it,
    # tmux server restarted): waiting forever would pin a pool worker for good and
    # silently starve the harness of its MAX_CONCURRENT slots.
    while not status_file.exists():
        if not window_alive(worktree_path):
            raise RuntimeError(f"tmux window '{window}' closed before the agent finished")
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
