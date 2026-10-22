#!/usr/bin/env bash
# Arguments and generated paths are allowlisted before they enter a remote shell.
# shellcheck disable=SC2029
set -euo pipefail

user=${1:?Missing user}
host=${2:?Missing host}
path=${3:?Missing destination}
release=${4:?Missing release ID}
KEEP_RELEASES=${KEEP_RELEASES:-4}
KEEP_DAYS=${KEEP_DAYS:-7}
[[ "$user" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ && "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
[[ "$path" =~ ^(/[a-zA-Z0-9_-]+)+$ ]]
[[ "$release" =~ ^[0-9a-f]{40}$ ]]
[[ "$KEEP_RELEASES" =~ ^[1-9][0-9]*$ && "$KEEP_DAYS" =~ ^[1-9][0-9]*$ ]]
remote="$user@$host"
destination="$remote:$path"
helper="$(dirname "$0")/ui_releases.py"
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
python3 "$helper" manifest ui/dist "$release" "$KEEP_RELEASES" "$KEEP_DAYS" > "$temporary/pending.json"

# EOF on the SSH pipe ends the lock owner; an existing lock fails closed.
coproc DEPLOY_LOCK { ssh "$remote" "set -eu
cd '$path'
test \"\$(pwd -P)\" = '$path'
test ! -L assets
test ! -L .ui-releases
test ! -L index.html
test ! -L .ui-index.html
mkdir .ui-deploy-lock
trap 'rmdir .ui-deploy-lock' 0
trap 'exit 1' 1 2 15
echo locked
cat >/dev/null"; }
lock_pid=$DEPLOY_LOCK_PID
# ShellCheck does not track a descriptor closed through a variable.
# shellcheck disable=SC2034
lock_input=${DEPLOY_LOCK[1]}
lock_output=${DEPLOY_LOCK[0]}
trap 'exec {lock_input}>&-; wait "$lock_pid" || true; rm -rf "$temporary"' EXIT
read -r locked <&"$lock_output"
[[ "$locked" == locked ]]

ssh "$remote" "mkdir -p '$path/.ui-releases'"
mkdir "$temporary/remote"
rsync -avz --exclude '*/' --include '*.json' --include '*.json.tmp' --exclude '*' "$destination/.ui-releases/" "$temporary/remote/"
ssh "$remote" "if test -f '$path/index.html'; then cat '$path/index.html'; fi" > "$temporary/active.html"
shopt -s nullglob
manifests=("$temporary/remote/"*.json)
if (( ${#manifests[@]} == 0 )); then
    ssh "$remote" "cd '$path'; if test -d assets; then find assets -type f -exec printf '%s\\000' {} +; fi" > "$temporary/legacy.list"
fi
python3 "$helper" plan "$temporary" "$release" "$KEEP_RELEASES" "$KEEP_DAYS" "$path"
ssh "$remote" sh < "$temporary/validate.sh"

rsync -avzc "$temporary/pending.json" "$destination/.ui-releases/$release.json.tmp"
rsync -avz ui/dist/assets/ "$destination/assets/"
rsync -avz --exclude assets/ --exclude index.html --exclude '.ui-*' ui/dist/ "$destination/"
rsync -avzc "$temporary/metadata/" "$destination/.ui-releases/"
rsync -avzc ui/dist/index.html "$destination/.ui-index.html"
kill -0 "$lock_pid"
# Commit all release metadata before the index; prune only after this command succeeds.
ssh "$remote" sh < "$temporary/publish.sh"
ssh "$remote" sh < "$temporary/cleanup.sh"
