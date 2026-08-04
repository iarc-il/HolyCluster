#!/usr/bin/env bash

set -euo pipefail

root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/bin" "$root/remote"

cat > "$root/bin/scp" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
source=$1
destination=${2#*:}
mkdir -p "$(dirname "$destination")"
cp "$source" "$destination"
SCRIPT

cat > "$root/bin/ssh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
shift
if [ "$#" -eq 1 ]; then
    bash -c "$1"
else
    "$@"
fi
SCRIPT

chmod +x "$root/bin/scp" "$root/bin/ssh"
printf 'windows installer' > "$root/HolyCluster.msi"
printf 'linux appimage' > "$root/HolyCluster.AppImage"

PATH="$root/bin:$PATH" bash "$(dirname "$0")/publish.sh" \
    --deploy-user deploy \
    --deploy-host host \
    --remote-artifact-dir "$root/remote" \
    --version catserver-v1.2.3 \
    --artifact "windows:x86_64:$root/HolyCluster.msi:catserver-v1.2.3-windows-x86_64.msi" \
    --artifact "linux:x86_64:$root/HolyCluster.AppImage:catserver-v1.2.3-linux-x86_64.AppImage"

test -f "$root/remote/artifacts/catserver-v1.2.3-windows-x86_64.msi"
test -f "$root/remote/artifacts/catserver-v1.2.3-linux-x86_64.AppImage"
test -f "$root/remote/artifacts/catserver-v1.2.3-windows-x86_64.msi.sha256"
python3 - "$root/remote/latest.json" <<'PY'
import json
import sys

manifest = json.load(open(sys.argv[1]))
assert manifest["schema_version"] == 1
assert {(release["platform"], release["architecture"]) for release in manifest["releases"]} == {
    ("windows", "x86_64"),
    ("linux", "x86_64"),
}
PY
