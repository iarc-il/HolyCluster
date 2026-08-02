import json
import os
import re
import secrets
import tempfile
from dataclasses import dataclass, asdict, fields
from pathlib import Path
from typing import Optional

PHASES = frozenset({
    "queued", "implementing", "ci", "ci_fixing",
    "await_review", "addressing", "blocked", "done", "closed",
})

# Phases the lifecycle never moves out of on its own.
TERMINAL_PHASES = frozenset({"done", "closed"})


@dataclass
class PRRecord:
    task: str
    slug: str
    branch: str
    worktree_path: str
    phase: str
    id: str = ""          # stable internal identity; slug is the display name
    pr_number: Optional[int] = None
    ci_fix_attempts: int = 0
    last_handled_review_id: Optional[int] = None
    no_check_polls: int = 0   # consecutive polls that found no CI checks at all
    blocked_reason: str = ""  # why this task stopped; only meaningful while blocked


def new_id() -> str:
    return secrets.token_hex(4)


def slugify(task: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", task.lower()).strip("-")
    return s[:50].rstrip("-")


def load_state(path: Path) -> list[PRRecord]:
    """Tolerate state written by a different version of this schema: unknown
    fields (e.g. after a rollback) are dropped with a warning rather than
    crashing every command with a bare TypeError."""
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    known = {f.name for f in fields(PRRecord)}
    records = []
    for d in data:
        unknown = sorted(set(d) - known)
        if unknown:
            print(f"[harness] ignoring unknown state fields {unknown} on {d.get('slug', '?')}")
        try:
            records.append(PRRecord(**{k: v for k, v in d.items() if k in known}))
        except TypeError as e:
            raise ValueError(f"malformed record in {path}: {d}") from e
    return records


def save_state(path: Path, records: list[PRRecord]) -> None:
    """Write atomically: a crash mid-write must never truncate the state file,
    since a half-written state.json makes every later command unloadable and
    strands the worktrees, branches, and PRs it described."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps([asdict(r) for r in records], indent=2)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".state-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def active_count(records: list[PRRecord]) -> int:
    return sum(1 for r in records if r.phase not in {"done", "blocked"})
