import json
import re
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Optional

PHASES = frozenset({
    "queued", "implementing", "ci", "ci_fixing",
    "await_review", "addressing", "blocked", "done",
})


@dataclass
class PRRecord:
    task: str
    slug: str
    branch: str
    worktree_path: str
    phase: str
    pr_number: Optional[int] = None
    ci_fix_attempts: int = 0
    last_handled_review_id: Optional[int] = None


def slugify(task: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", task.lower()).strip("-")
    return s[:50].rstrip("-")


def load_state(path: Path) -> list[PRRecord]:
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    return [PRRecord(**d) for d in data]


def save_state(path: Path, records: list[PRRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([asdict(r) for r in records], indent=2))


def active_count(records: list[PRRecord]) -> int:
    return sum(1 for r in records if r.phase not in {"done", "blocked"})
