import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from loguru import logger


@dataclass(frozen=True)
class LogFilePolicy:
    rotation: str = "10 MB"
    retention: int = 5
    compression: str | None = "zip"


DEFAULT_LOG_FILE_POLICY = LogFilePolicy()
_ROTATED_LOG_PATTERN = re.compile(r"\.\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_\d+)?(?:\.[^.]+)*$")
_COMPRESSED_SUFFIXES = (".bz2", ".gz", ".lzma", ".xz", ".zip", ".tar.gz")


def add_bounded_file_sink(
    path: str | Path,
    *,
    level: str = "INFO",
    filter: Callable | str | dict | None = None,
    format: str | Callable | None = None,
    policy: LogFilePolicy = DEFAULT_LOG_FILE_POLICY,
) -> int:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    options = {
        "level": level,
        "rotation": policy.rotation,
        "retention": policy.retention,
        "compression": policy.compression,
    }
    if filter is not None:
        options["filter"] = filter
    if format is not None:
        options["format"] = format

    return logger.add(str(path), **options)


def prune_rotated_logs(
    root: str | Path,
    *,
    max_bytes: int,
    active_paths: Iterable[str | Path] = (),
) -> list[Path]:
    if max_bytes < 0:
        raise ValueError("max_bytes must not be negative")

    root = Path(root)
    if not root.exists():
        return []

    active = {Path(path).resolve() for path in active_paths}
    candidates = [
        path for path in root.rglob("*") if path.is_file() and path.resolve() not in active and _is_rotated_log(path)
    ]
    tracked = candidates + [path for path in active if path.is_file()]
    total_bytes = sum(path.stat().st_size for path in tracked)
    deleted: list[Path] = []

    for path in sorted(candidates, key=lambda candidate: (candidate.stat().st_mtime, str(candidate))):
        if total_bytes <= max_bytes:
            break
        size = path.stat().st_size
        path.unlink()
        total_bytes -= size
        deleted.append(path)

    return deleted


def _is_rotated_log(path: Path) -> bool:
    return bool(_ROTATED_LOG_PATTERN.search(path.name)) or path.name.endswith(_COMPRESSED_SUFFIXES)
