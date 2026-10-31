import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import sys
import time
import uuid

RELEASE = re.compile(r"[0-9a-f]{40}")
ASSET = re.compile(r"assets/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+")


def asset_name(name):
    if not isinstance(name, str) or not ASSET.fullmatch(name):
        raise ValueError("Invalid asset path")
    return name


def manifest(data):
    if data["release"] != "legacy" and not RELEASE.fullmatch(data["release"]):
        raise ValueError("Invalid release")
    if (
        not isinstance(data["published_at"], (int, float))
        or not 0 < data["published_at"] <= time.time() + 60
    ):
        raise ValueError("Invalid publication time")
    if not isinstance(data["assets"], list):
        raise ValueError("Invalid assets")
    for name in data["assets"]:
        asset_name(name)
    if not isinstance(data.get("published", True), bool):
        raise ValueError("Invalid publication state")
    if "index_sha256" in data and not re.fullmatch(r"[0-9a-f]{64}", data["index_sha256"]):
        raise ValueError("Invalid index digest")
    return data


def shell_script(path, lines):
    path.write_text("set -eu\n" + "\n".join(lines) + "\n")


def main():
    mode, directory, release, minimum, days = sys.argv[1:6]
    if not RELEASE.fullmatch(release):
        raise ValueError("Invalid release ID")
    minimum, days = int(minimum), int(days)
    if minimum < 1 or days < 1:
        raise ValueError("Invalid retention policy")
    root = Path(directory).absolute()
    if mode == "manifest":
        assets = []
        for path in (root / "assets").rglob("*"):
            if path.is_symlink():
                raise ValueError("Symbolic build asset")
            if path.is_file():
                assets.append(asset_name(str(path.relative_to(root))))
        data = manifest({
            "release": release, "published_at": time.time(), "assets": sorted(assets),
            "index_sha256": hashlib.sha256((root / "index.html").read_bytes()).hexdigest(),
            "published": False,
        })
        print(json.dumps(data))
        return

    remote_root = sys.argv[6]
    if not re.fullmatch(r"(?:/[A-Za-z0-9_-]+)+", remote_root):
        raise ValueError("Invalid deployment path")
    records = []
    abandoned = []
    active_digest = hashlib.sha256((root / "active.html").read_bytes()).hexdigest()
    metadata = root / "metadata"
    metadata.mkdir()
    updates = []
    remote_files = set()
    for path in (root / "remote").iterdir():
        if path.is_symlink() or not path.is_file():
            raise ValueError("Invalid manifest file")
        data = manifest(json.loads(path.read_text()))
        name = data["release"] + ".json"
        if path.name not in (name, name + ".tmp"):
            raise ValueError("Invalid manifest name")
        remote_files.add(path.name)
        if path.name.endswith(".tmp"):
            abandoned.append(data)
            continue
        # Recover a publication interrupted after the index commit.
        if data.get("index_sha256") == active_digest and not data.get("published", True):
            data["published"] = True
            (metadata / (name + ".tmp")).write_text(json.dumps(data))
            updates.append(name)
        records.append(data)

    pending = manifest(json.loads((root / "pending.json").read_text()))
    if not records:
        # Snapshot legacy assets once; the same release policy expires this baseline.
        names = (root / "legacy.list").read_bytes().split(b"\0")
        if names[-1] != b"":
            raise ValueError("Invalid legacy asset list")
        legacy = manifest({
            "release": "legacy", "published_at": time.time(),
            "assets": sorted(asset_name(name.decode()) for name in names[:-1]),
        })
        records.append(legacy)
        (metadata / "legacy.json.tmp").write_text(json.dumps(legacy))
        updates.append("legacy.json")
    previous = next((data for data in records if data["release"] == release), None)
    if previous and previous["assets"] != pending["assets"]:
        raise ValueError("Release ID reused for different assets")
    pending["published_at"] = time.time()
    name = release + ".json"
    (metadata / (name + ".tmp")).write_text(json.dumps(pending))
    updates = [item for item in updates if item != name] + [name]
    records = [data for data in records if data["release"] != release]
    # The plan runs only after the new index commits; failed stages do not displace releases.
    records.append({**pending, "published": True})
    records.sort(key=lambda data: data["published_at"], reverse=True)
    successful = [data for data in records if data["release"] != "legacy" and data.get("published", True)]
    cutoff = time.time() - days * 86400
    retained = [data for data in records if (
        data in successful[:minimum]
        or data["published_at"] >= cutoff
        or (data["release"] == "legacy" and len(successful) < minimum)
    )]
    expired = [data for data in records if data not in retained]
    keep = {name for data in retained for name in data["assets"]}
    candidates = {name for data in expired + abandoned for name in data["assets"]} - keep
    assets = {name for data in records + abandoned for name in data["assets"]}
    checks = []
    attempt = uuid.uuid4().hex
    diagnostic_name = f".ui-deployments/{attempt}"
    journal = f"{remote_root}/{diagnostic_name}.jsonl"

    def event(kind, **details):
        data = {"event": kind, "attempt": attempt, "build": release, **details}
        prefix = json.dumps(data, sort_keys=True, separators=(",", ":"))[:-1] + ',"timestamp":'
        return f"printf '%s%s%s\\n' {shlex.quote(prefix)} \"$(date +%s)\" '}}' >> '{journal}'"

    # Keep history separate from expiring manifests, including repeated builds.
    diagnostics = {
        "schema": 1, "attempt": attempt, "build": release,
        "release": os.environ.get("VITE_SENTRY_RELEASE") or release,
        "planned_at": time.time(), "index_sha256": pending["index_sha256"],
        "published_assets": sorted(pending["assets"]),
        "retention": {"minimum_releases": minimum, "days": days},
        "retained_releases": sorted(data["release"] for data in retained),
        "retained_assets": sorted(keep),
        "expired_releases": sorted(data["release"] for data in expired),
        "abandoned_releases": sorted(data["release"] for data in abandoned),
        "prune_candidates": sorted(candidates),
    }
    (root / "diagnostics.json").write_text(json.dumps(diagnostics, sort_keys=True, separators=(",", ":")) + "\n")
    (root / "diagnostic-name").write_text(diagnostic_name)
    targets = {"assets", ".ui-releases", "index.html", ".ui-index.html", ".ui-deployments",
               diagnostic_name + ".json", diagnostic_name + ".jsonl"}
    for name in assets:
        targets.update(str(parent) for parent in Path(name).parents if str(parent) != ".")
        targets.add(name)
    targets.update(".ui-releases/" + name for name in remote_files)
    targets.update(".ui-releases/" + name + suffix for name in updates for suffix in ("", ".tmp"))
    for name in sorted(targets):
        checks.append(f"test ! -L '{remote_root}/{name}'")
    shell_script(root / "validate.sh", checks)
    shell_script(root / "start.sh", ["umask 077", event("deployment_started")])
    publish = [event("publication_started")]
    publish += [f"mv '{remote_root}/.ui-releases/{name}.tmp' '{remote_root}/.ui-releases/{name}'" for name in updates]
    publish.append(f"mv '{remote_root}/.ui-index.html' '{remote_root}/index.html'")
    publish.append(event("published"))
    shell_script(root / "publish.sh", publish)
    cleanup = ["pruned=0"]
    for name in sorted(candidates):
        cleanup += [f"if test -e '{remote_root}/{name}'; then",
                    f"rm '{remote_root}/{name}'", event("asset_pruned", asset=name),
                    "pruned=$((pruned + 1))", "fi"]
    for data in sorted(expired, key=lambda data: data["release"]):
        cleanup += [f"rm '{remote_root}/.ui-releases/{data['release']}.json'",
                    event("release_pruned", release=data["release"])]
    cleanup += [f"rm -f '{remote_root}/.ui-releases/{name}'" for name in sorted(remote_files) if name.endswith(".tmp")]
    cleanup.append(event("cleanup_completed"))
    summary = json.dumps({
        "event": "ui_deployment_completed", "attempt": attempt, "build": release,
        "diagnostics": diagnostic_name + ".json", "events": diagnostic_name + ".jsonl",
        "published_assets": len(pending["assets"]), "retained_assets": len(keep),
        "retained_releases": len(retained),
    }, separators=(",", ":"))[:-1] + ',"pruned_assets":'
    cleanup.append(f"printf '%s%s%s\\n' {shlex.quote(summary)} \"$pruned\" '}}'")
    shell_script(root / "cleanup.sh", cleanup)


if __name__ == "__main__":
    main()
