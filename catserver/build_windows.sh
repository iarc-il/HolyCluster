#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

TARGET=x86_64-pc-windows-gnu
SOURCE_ROOT=$(pwd -P)
ESCAPED_SOURCE_ROOT=${SOURCE_ROOT//\/\\}
ESCAPED_SOURCE_ROOT=${ESCAPED_SOURCE_ROOT//\"/\\\"}
PREFIX_MAP="-ffile-prefix-map=$SOURCE_ROOT=/src"
export CFLAGS="${CFLAGS:+$CFLAGS }$PREFIX_MAP"
export CXXFLAGS="${CXXFLAGS:+$CXXFLAGS }$PREFIX_MAP"

cargo build \
    --config "target.$TARGET.rustflags = [\"--remap-path-prefix=$ESCAPED_SOURCE_ROOT=/src\"]" \
    --workspace \
    --target "$TARGET" \
    --release \
    --locked
