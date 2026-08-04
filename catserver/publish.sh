#!/usr/bin/env bash

set -euo pipefail

usage() {
    echo "Usage: $0 --deploy-user USER --deploy-host HOST --remote-artifact-dir DIR --version VERSION --artifact PLATFORM:ARCHITECTURE:PATH:NAME [--artifact ...]" >&2
}

fail() {
    echo "$1" >&2
    exit 1
}

main() {
    local deploy_user=
    local deploy_host=
    local remote_artifact_dir=
    local version=
    local manifest
    local remote
    local remote_stage
    local run_id
    local artifact
    local platform
    local architecture
    local local_path
    local artifact_name
    local artifact_hash
    local -a artifacts=()
    local -a artifact_names=()

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --deploy-user|--deploy-host|--remote-artifact-dir|--version|--artifact)
                [ "$#" -ge 2 ] || fail "Missing value for $1"
                case "$1" in
                    --deploy-user) deploy_user="$2" ;;
                    --deploy-host) deploy_host="$2" ;;
                    --remote-artifact-dir) remote_artifact_dir="$2" ;;
                    --version) version="$2" ;;
                    --artifact) artifacts+=("$2") ;;
                esac
                shift 2
                ;;
            *)
                usage
                fail "Unknown argument: $1"
                ;;
        esac
    done

    [ -n "$deploy_user" ] || fail "Missing --deploy-user"
    [ -n "$deploy_host" ] || fail "Missing --deploy-host"
    [ -n "$remote_artifact_dir" ] || fail "Missing --remote-artifact-dir"
    [ -n "$version" ] || fail "Missing --version"
    [ "${#artifacts[@]}" -gt 0 ] || fail "At least one --artifact is required"
    [[ "$remote_artifact_dir" =~ ^/[A-Za-z0-9_./-]+$ && "$remote_artifact_dir" != *..* ]] || fail "Invalid remote artifact directory"

    for artifact in "${artifacts[@]}"; do
        IFS=: read -r platform architecture local_path artifact_name extra <<< "$artifact"
        [ -n "$platform" ] && [ -n "$architecture" ] && [ -n "$local_path" ] && [ -n "$artifact_name" ] && [ -z "${extra:-}" ] || fail "Invalid artifact: $artifact"
        [ -f "$local_path" ] || fail "Artifact does not exist: $local_path"
        [[ "$platform" =~ ^(linux|windows)$ ]] || fail "Invalid platform: $platform"
        [ "$architecture" = "x86_64" ] || fail "Invalid architecture: $architecture"
        [[ "$artifact_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "Invalid artifact name: $artifact_name"
        case "$platform" in
            linux) [[ "$artifact_name" == *.AppImage ]] || fail "Linux artifact must be an AppImage" ;;
            windows) [[ "$artifact_name" == *.msi ]] || fail "Windows artifact must be an MSI" ;;
        esac
        artifact_names+=("$artifact_name")
    done

    manifest=$(mktemp)
    trap "rm -f -- '$manifest'" EXIT
    python3 - "$version" "$manifest" "${artifacts[@]}" <<'PY'
import hashlib
import json
import pathlib
import re
import sys

version, output, *artifacts = sys.argv[1:]
if not re.fullmatch(r"catserver-v\d+\.\d+\.\d+(?:-\d+-g[0-9a-f]+)?", version):
    raise SystemExit("Invalid version")

releases = []
seen_targets = set()
for artifact in artifacts:
    platform, architecture, path, name = artifact.split(":", 3)
    if (platform, architecture) in seen_targets:
        raise SystemExit(f"Duplicate release target: {platform}/{architecture}")
    seen_targets.add((platform, architecture))
    artifact_path = pathlib.Path(path)
    releases.append(
        {
            "version": version,
            "platform": platform,
            "architecture": architecture,
            "artifact": {
                "location": f"/catserver/artifacts/{name}",
                "name": name,
                "sha256": hashlib.sha256(artifact_path.read_bytes()).hexdigest(),
                "size": artifact_path.stat().st_size,
            },
        }
    )

pathlib.Path(output).write_text(json.dumps({"schema_version": 1, "releases": releases}, separators=(",", ":")))
PY

    remote="$deploy_user@$deploy_host"
    run_id="$(date +%s)-$$"
    remote_stage="$remote_artifact_dir/.staging/$run_id"
    ssh "$remote" mkdir -p -- "$remote_stage"

    for artifact in "${artifacts[@]}"; do
        IFS=: read -r platform architecture local_path artifact_name <<< "$artifact"
        artifact_hash=$(sha256sum "$local_path" | cut -d ' ' -f 1)
        printf '%s  %s\n' "$artifact_hash" "$artifact_name" | ssh "$remote" "cat > '$remote_stage/$artifact_name.sha256'"
        scp "$local_path" "$remote:$remote_stage/$artifact_name"
    done
    scp "$manifest" "$remote:$remote_stage/latest.json"

    ssh "$remote" bash -s -- "$remote_artifact_dir" "$run_id" "${artifact_names[@]}" <<'REMOTE'
set -euo pipefail

release_dir=$1
run_id=$2
shift 2
stage="$release_dir/.staging/$run_id"

exec 9>"$release_dir/.publish.lock"
flock 9
mkdir -p "$release_dir/artifacts"

for name in "$@"; do
    staged_artifact="$stage/$name"
    staged_hash="$stage/$name.sha256"
    expected_hash=$(cut -d ' ' -f 1 "$staged_hash")
    actual_hash=$(sha256sum "$staged_artifact" | cut -d ' ' -f 1)
    [ "$actual_hash" = "$expected_hash" ] || { echo "Artifact hash mismatch: $name" >&2; exit 1; }

    if [ -e "$release_dir/artifacts/$name" ]; then
        cmp -s "$staged_artifact" "$release_dir/artifacts/$name" || { echo "Immutable artifact already exists: $name" >&2; exit 1; }
        rm "$staged_artifact"
    else
        mv "$staged_artifact" "$release_dir/artifacts/$name"
    fi
    mv "$staged_hash" "$release_dir/artifacts/$name.sha256"
done

mv "$stage/latest.json" "$release_dir/latest.json"
rmdir "$stage"
REMOTE
}

main "$@"
