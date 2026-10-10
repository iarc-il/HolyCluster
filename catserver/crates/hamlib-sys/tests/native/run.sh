#!/bin/bash
set -euo pipefail
PREFIX=${1:?pass the Cargo-managed Hamlib prefix}
printf 'native_prefix=%s\n' "$PREFIX"
sha256sum "$PREFIX/lib/libhamlib.a" "$PREFIX/include/hamlib/rig.h"
D=$(mktemp -d)
trap 'rm -rf "$D"' EXIT
SRC=$(cd "$(dirname "$0")" && pwd)
read -ra LIBS <<< "$(pkg-config --static --libs-only-other --libs-only-l "$PREFIX/lib/pkgconfig/hamlib.pc")"
FILTERED=()
for lib in "${LIBS[@]}"; do
    [[ "$lib" == -lhamlib ]] || FILTERED+=("$lib")
done
for test in immediate_copy history; do
    cc -std=c11 -O2 -Wall -Wextra -Werror -pthread -I"$PREFIX/include" "$SRC/$test.c" \
        "$PREFIX/lib/libhamlib.a" "${FILTERED[@]}" -o "$D/$test"
done
for run in 1 2 3; do
    timeout 30s "$D/immediate_copy" normal 200000
done
timeout 30s "$D/immediate_copy" coordinated 1000
timeout 30s "$D/history"
