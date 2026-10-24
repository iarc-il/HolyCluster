#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

SCENARIOS = ("update", "corrupt-download")


def identity(path):
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return {"sha256": digest.hexdigest(), "size": size}


def candidates(linux, windows, version):
    return {
        platform: {"version": version, **identity(artifact)}
        for platform, artifact in (("linux", linux), ("windows", windows))
    }


def run(baseline, linux, windows, version, dist, output):
    descriptor = json.loads((baseline / "baseline.json").read_text())
    releases = descriptor["releases"]
    if {item["platform"] for item in releases} != {"linux", "windows"} or len(releases) != 2:
        raise ValueError("Baseline must contain both platforms")
    for item in releases:
        artifact = (baseline / item["path"]).resolve()
        if not artifact.is_relative_to(baseline.resolve()):
            raise ValueError("Baseline path is outside the snapshot")
        if identity(artifact) != {key: item[key] for key in ("sha256", "size")}:
            raise ValueError("Baseline bytes differ from snapshot")
    data = {
        "schema_version": 1,
        "commit": os.environ.get("GITHUB_SHA"),
        "run_id": os.environ.get("GITHUB_RUN_ID"),
        "baseline": releases,
        "candidate": candidates(linux, windows, version),
        "scenarios": {},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    baseline_linux = baseline / next(item["path"] for item in releases if item["platform"] == "linux")
    for scenario in SCENARIOS:
        with (output.parent / f"{scenario}.log").open("w") as log:
            try:
                code = subprocess.call(
                    ["node", "ui/scripts/linux_update_product.mjs", "--baseline", str(baseline_linux),
                     "--candidate", str(linux), "--version", version, "--dist", str(dist),
                     "--scenario", scenario],
                    stdout=log, stderr=subprocess.STDOUT, timeout=180,
                )
            except (OSError, subprocess.TimeoutExpired) as error:
                log.write(f"{error}\n")
                code = -1
        data["scenarios"][scenario] = {"passed": code == 0, "exit_code": code}
        output.write_text(json.dumps(data, indent=2) + "\n")
    if data["candidate"] != candidates(linux, windows, version):
        raise ValueError("Candidate changed during product tests")
    return all(result["passed"] for result in data["scenarios"].values())


def verify(attestation, linux, windows, version):
    data = json.loads(attestation.read_text())
    if data.get("schema_version") != 1 or data.get("candidate") != candidates(linux, windows, version):
        raise ValueError("Candidate bytes or version differ from attestation")
    results = data.get("scenarios", {})
    if set(results) != set(SCENARIOS) or any(
        result.get("passed") is not True or result.get("exit_code") != 0
        for result in results.values()
    ):
        raise ValueError("Both Linux update scenarios must pass")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("run", "verify"))
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--linux", type=Path, required=True)
    parser.add_argument("--windows", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--dist", type=Path)
    parser.add_argument("--attestation", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.mode == "verify":
            verify(args.attestation, args.linux, args.windows, args.version)
        else:
            if not args.baseline or not args.dist:
                parser.error("run requires --baseline and --dist")
            if not run(args.baseline, args.linux, args.windows, args.version, args.dist, args.attestation):
                parser.exit(1, "Linux update scenarios failed; see scenario logs\n")
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Update gate failed: {error}\n")


if __name__ == "__main__":
    main()
