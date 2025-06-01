#!/bin/bash
set -e

TARGET=x86_64-pc-windows-gnu
BUILD_DIR=target/$TARGET/release
WIX_NAME=main
DIALOG_NAME=CustomInstallDirDlg
OUTPUT_PATH=$BUILD_DIR/HolyCluster.msi

GIT_TAG=$(git describe --match 'catserver-v*')
BASE_VERSION=$(echo $GIT_TAG | sed -rn 's/catserver-v([.0-9]*)(-.*)?/\1/p')
SUB_VERSION=$(echo $GIT_TAG | sed -rn 's/catserver-v[.0-9]*-(.*)-.*/\1/p')
VERSION=$BASE_VERSION.${SUB_VERSION:-0}

run_wix() {
    cp $BUILD_DIR/catserver.exe $BUILD_DIR/HolyCluster.exe
    wix build \
        -d Version=$VERSION \
        -d CargoTargetBinDir=$BUILD_DIR wix/$WIX_NAME.wxs \
         -ext WixToolset.UI.wixext \
        -o "$BUILD_DIR/HolyCluster.msi"
    echo "MSI complied successfuly (version $VERSION): $OUTPUT_PATH"
}

main() {
    if [ "$1" = "in-docker" ]; then
        run_wix
    else
        docker run -v $(pwd)/..:/work -w /work/catserver --rm ghcr.io/iarc-il/catserver-ci:latest $0 in-docker
    fi
}

main $@
