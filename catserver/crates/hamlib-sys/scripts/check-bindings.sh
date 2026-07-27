#!/usr/bin/env bash
set -euo pipefail

crate_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
temporary=$(mktemp "$crate_dir/src/bindings.rs.XXXXXX")
trap 'rm -f "$temporary"' EXIT
"$crate_dir/scripts/generate-bindings.sh" "$temporary"
diff -u "$crate_dir/src/bindings.rs" "$temporary"
