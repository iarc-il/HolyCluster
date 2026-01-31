#!/bin/bash
set -e

echo "=== Verifying MSI Build Determinism ==="
echo ""

# Build first time
echo "Building MSI (first build)..."
./build_msi.sh
cp target/x86_64-pc-windows-gnu/release/HolyCluster.msi /tmp/msi1.msi
HASH1=$(sha256sum /tmp/msi1.msi | cut -d' ' -f1)
echo "First build SHA256: $HASH1"
echo ""

# Clean build artifacts
echo "Cleaning build artifacts..."
cargo clean
echo ""

# Build second time
echo "Building MSI (second build)..."
./build_msi.sh
cp target/x86_64-pc-windows-gnu/release/HolyCluster.msi /tmp/msi2.msi
HASH2=$(sha256sum /tmp/msi2.msi | cut -d' ' -f1)
echo "Second build SHA256: $HASH2"
echo ""

# Compare
if [ "$HASH1" = "$HASH2" ]; then
    echo "SUCCESS: MSI files are byte-for-byte identical!"
    echo "SHA256: $HASH1"
    exit 0
else
    echo "FAILURE: MSI files differ!"
    echo "First:  $HASH1"
    echo "Second: $HASH2"
    echo ""
    echo "Binary diff (first 20 differences):"
    cmp -l /tmp/msi1.msi /tmp/msi2.msi | head -20
    exit 1
fi
