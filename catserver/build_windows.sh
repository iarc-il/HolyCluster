#!/bin/bash
# Optional convenience entry. Reproducible release configuration lives in CI.
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

exec cargo build --workspace --target x86_64-pc-windows-gnu --release --locked "$@"
