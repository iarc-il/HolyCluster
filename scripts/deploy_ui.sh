#!/usr/bin/env bash
# Arguments are allowlisted before they enter a remote shell.
# shellcheck disable=SC2029
set -euo pipefail

user=${1:?Missing user}
host=${2:?Missing host}
path=${3:?Missing destination}
release=${4:?Missing release ID}
KEEP_RELEASES=${KEEP_RELEASES:-4}
KEEP_DAYS=${KEEP_DAYS:-7}
[[ "$user" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ && "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
[[ "$path" =~ ^/[a-zA-Z0-9_/-]+$ && "$path" != / && "$path" != *'/../'* ]]
[[ "$release" =~ ^[0-9a-f]{40}$ ]]
[[ "$KEEP_RELEASES" =~ ^[1-9][0-9]*$ && "$KEEP_DAYS" =~ ^[1-9][0-9]*$ ]]
remote="$user@$host"
destination="$remote:$path"
helper="$(dirname "$0")/ui_releases.py"
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
python3 "$helper" manifest ui/dist "$release" "$KEEP_RELEASES" "$KEEP_DAYS" > "$temporary/pending.json"

python3 -c 'import json, pathlib, sys; print("incoming = " + repr(json.loads(pathlib.Path(sys.argv[1]).read_text()))); print(pathlib.Path(sys.argv[2]).read_text())' "$temporary/pending.json" "$helper" > "$temporary/remote.py"
ssh "$remote" "python3 - preflight '$path' '$release' '$KEEP_RELEASES' '$KEEP_DAYS'" < "$temporary/remote.py"
# The SSH pipe releases the lock even if the runner stops without an exit trap.
coproc DEPLOY_LOCK { ssh "$remote" "flock -n '$path/.ui-deploy.lock' sh -c 'echo locked; cat >/dev/null'"; }
lock_pid=$DEPLOY_LOCK_PID
# ShellCheck does not track a descriptor closed through a variable.
# shellcheck disable=SC2034
lock_input=${DEPLOY_LOCK[1]}
lock_output=${DEPLOY_LOCK[0]}
trap 'exec {lock_input}>&-; wait "$lock_pid" || true; rm -rf "$temporary"' EXIT
read -r locked <&"$lock_output"
[[ "$locked" == locked ]]
ssh "$remote" "python3 - preflight '$path' '$release' '$KEEP_RELEASES' '$KEEP_DAYS'" < "$temporary/remote.py"

ssh "$remote" "mkdir -p '$path/.ui-releases'"
rsync -avzc "$temporary/pending.json" "$destination/.ui-releases/$release.json.tmp"
rsync -avz ui/dist/assets/ "$destination/assets/"
rsync -avz --exclude assets/ --exclude index.html --exclude '.ui-*' ui/dist/ "$destination/"
rsync -avzc ui/dist/index.html "$destination/.ui-index.html"
# The remote helper validates all metadata before it commits the index.
kill -0 "$lock_pid"
ssh "$remote" "python3 - publish '$path' '$release' '$KEEP_RELEASES' '$KEEP_DAYS'" < "$helper"
