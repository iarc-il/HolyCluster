import hashlib
import json
from pathlib import Path
import re
import sys
import time

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
    targets = {"assets", ".ui-releases", "index.html", ".ui-index.html"}
    for name in assets:
        targets.update(str(parent) for parent in Path(name).parents if str(parent) != ".")
        targets.add(name)
    targets.update(".ui-releases/" + name for name in remote_files)
    targets.update(".ui-releases/" + name + suffix for name in updates for suffix in ("", ".tmp"))
    for name in sorted(targets):
        checks.append(f"test ! -L '{remote_root}/{name}'")
    shell_script(root / "validate.sh", checks)
    publish = [f"mv '{remote_root}/.ui-releases/{name}.tmp' '{remote_root}/.ui-releases/{name}'" for name in updates]
    publish.append(f"mv '{remote_root}/.ui-index.html' '{remote_root}/index.html'")
    shell_script(root / "publish.sh", publish)
    cleanup = [f"rm -f '{remote_root}/{name}'" for name in sorted(candidates)]
    cleanup += [f"rm -f '{remote_root}/.ui-releases/{data['release']}.json'" for data in expired]
    cleanup += [f"rm -f '{remote_root}/.ui-releases/{name}'" for name in sorted(remote_files) if name.endswith(".tmp")]
    shell_script(root / "cleanup.sh", cleanup)


if __name__ == "__main__":
    main()
