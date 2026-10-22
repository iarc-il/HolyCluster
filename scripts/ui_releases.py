import json
import os
from pathlib import Path
import re
import sys
import time

RELEASE = re.compile(r"[0-9a-f]{40}")
ASSET = re.compile(r"assets/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+")


def asset_path(root, name, required=True):
    if not isinstance(name, str) or not ASSET.fullmatch(name):
        raise ValueError("Invalid asset path")
    path = root / name
    if path.resolve() != path.absolute() or (required and not path.is_file()):
        raise ValueError("Missing asset or symbolic link")
    return path


def manifest(root, data, required=True):
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
        asset_path(root, name, required=required)
    return data


def main():
    mode, directory, release, minimum, days = sys.argv[1:]
    if not RELEASE.fullmatch(release):
        raise ValueError("Invalid release ID")
    minimum, days = int(minimum), int(days)
    if minimum < 1 or days < 1:
        raise ValueError("Invalid retention policy")
    root = Path(directory).absolute()
    if root.resolve() != root:
        raise ValueError("Symbolic deployment path")
    if mode == "manifest":
        if any(path.is_symlink() for path in (root / "assets").rglob("*")):
            raise ValueError("Symbolic build asset")
        assets = sorted(
            str(path.relative_to(root))
            for path in (root / "assets").rglob("*") if path.is_file()
        )
        data = manifest(root, {"release": release, "published_at": time.time(), "assets": assets})
        print(json.dumps(data))
        return
    store = root / ".ui-releases"
    if store.is_symlink():
        raise ValueError("Symbolic metadata directory")
    if mode == "preflight":
        for name in [
            "assets", ".ui-index.html", "index.html", ".ui-deploy.lock",
            f".ui-releases/{release}.json.tmp",
        ]:
            path = root / name
            if path.resolve() != path:
                raise ValueError("Symbolic deployment target")
        for name in incoming["assets"]:
            asset_path(root, name, required=False)
        return
    store.mkdir(exist_ok=True)
    records = []
    for path in store.glob("*.json"):
        if path.is_symlink():
            raise ValueError("Symbolic manifest")
        data = manifest(root, json.loads(path.read_text()), required=False)
        if path.name != data["release"] + ".json":
            raise ValueError("Invalid manifest name")
        records.append((path, data))
    abandoned = []
    for path in store.glob("*.json.tmp"):
        if path.is_symlink():
            raise ValueError("Symbolic pending manifest")
        data = manifest(root, json.loads(path.read_text()), required=False)
        if path.name != data["release"] + ".json.tmp":
            raise ValueError("Invalid pending manifest name")
        abandoned.append((path, data))
    pending_path = store / f"{release}.json.tmp"
    pending = manifest(root, json.loads(pending_path.read_text()))
    if pending["release"] != release:
        raise ValueError("Release mismatch")
    if not records:
        # Snapshot legacy assets once; the same release policy expires this baseline.
        legacy = sorted(
            str(path.relative_to(root))
            for path in (root / "assets").rglob("*") if path.is_file()
        )
        data = manifest(root, {"release": "legacy", "published_at": time.time(), "assets": legacy})
        path = store / "legacy.json"
        path.write_text(json.dumps(data))
        records.append((path, data))
    pending["published_at"] = time.time()
    pending_path.write_text(json.dumps(pending))
    records = [(path, data) for path, data in records if data["release"] != release]
    records.append((store / f"{release}.json", pending))
    records.sort(key=lambda record: record[1]["published_at"], reverse=True)
    cutoff = time.time() - days * 86400
    successful = [record for record in records if record[1]["release"] != "legacy"]
    retained = [
        record for record in records
        if record in successful[:minimum]
        or record[1]["published_at"] >= cutoff
        or (record[1]["release"] == "legacy" and len(successful) < minimum)
    ]
    for _, data in retained:
        manifest(root, data)
    os.replace(root / ".ui-index.html", root / "index.html")
    os.replace(pending_path, store / f"{release}.json")
    expired = [record for record in records if record not in retained]
    abandoned = [record for record in abandoned if record[0] != pending_path]
    keep = {name for _, data in retained for name in data["assets"]}
    candidates = {name for _, data in expired + abandoned for name in data["assets"]} - keep
    for name in candidates:
        asset_path(root, name, required=False).unlink(missing_ok=True)
    for path, _ in expired + abandoned:
        path.unlink()


if __name__ == "__main__":
    main()
