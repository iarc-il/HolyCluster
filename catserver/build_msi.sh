#!/bin/bash
set -e

TARGET=x86_64-pc-windows-gnu
BUILD_DIR=target/$TARGET/release
WIX_NAME=main
DIALOG_NAME=CustomInstallDirDlg
OUTPUT_PATH=$BUILD_DIR/HolyCluster.msi

GIT_TAG=$(git describe --match 'catserver-v*')
BASE_VERSION=$(echo $GIT_TAG | sed -rn 's/catserver-v([.0-9]*)(-.*)?/\1/p')
BUGFIX_VERSION=$(echo $BASE_VERSION | sed -rn "s/[0-9]*\.[0-9]*\.([0-9]*)/\1/p")
MAJOR_AND_MINOR_VERSION=$(echo $BASE_VERSION | sed -rn "s/([0-9]*\.[0-9]*).*/\1/p")
SUB_VERSION=$(echo $GIT_TAG | sed -rn 's/catserver-v[.0-9]*-(.*)-.*/\1/p')
SUB_VERSION=${SUB_VERSION:-0}
NEW_BUGFIX_VERSION=$(( SUB_VERSION * 10 + BUGFIX_VERSION ))
VERSION=$MAJOR_AND_MINOR_VERSION.$NEW_BUGFIX_VERSION

# Extract commit timestamp for reproducible builds
COMMIT_HASH=$(git rev-parse HEAD)
COMMIT_TIMESTAMP=$(git log -1 --format=%ct "$COMMIT_HASH")
export SOURCE_DATE_EPOCH=$COMMIT_TIMESTAMP

# Generate deterministic Package Code GUID from commit hash
PACKAGE_CODE=$(python3 -c "import uuid; print(str(uuid.uuid5(uuid.NAMESPACE_DNS, '$COMMIT_HASH')).upper())")

echo "Building deterministic MSI"
echo "  Version: $VERSION"
echo "  Commit: $COMMIT_HASH"
echo "  Package Code: $PACKAGE_CODE"
echo "  Timestamp: $COMMIT_TIMESTAMP ($(date -u -d @"$COMMIT_TIMESTAMP" '+%Y-%m-%d %H:%M:%S UTC'))"

run_wix() {
    # Erase exe timestamps
    python3 scripts/normalize_pe.py "$BUILD_DIR/catserver.exe"

    cp "$BUILD_DIR/catserver.exe" "$BUILD_DIR/HolyCluster.exe"

    wix build \
        -d Version=$VERSION \
        -d PackageCode=$PACKAGE_CODE \
        -d SourceDateEpoch=$SOURCE_DATE_EPOCH \
        -d CargoTargetBinDir=$BUILD_DIR wix/$WIX_NAME.wxs \
        -ext WixToolset.UI.wixext \
        -o "$OUTPUT_PATH"

    # Erase msi timestamps
    python3 scripts/normalize_msi.py "$OUTPUT_PATH" "$SOURCE_DATE_EPOCH"

    echo "MSI compiled successfully: $OUTPUT_PATH"
    sha256sum "$OUTPUT_PATH"
}

main() {
    if [ "$1" = "in-docker" ]; then
        run_wix
    else
        docker run -v $(pwd)/..:/work -w /work/catserver --rm ghcr.io/iarc-il/catserver-ci:latest $0 in-docker
    fi
}

main $@
