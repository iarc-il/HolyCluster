#!/bin/bash

TARGET=x86_64-pc-windows-gnu
BUILD_DIR=target/$TARGET/release
WIX_NAME=main
DIALOG_NAME=CustomInstallDirDlg
OUTPUT_PATH=$BUILD_DIR/HolyCluster.msi
VERSION=0.1.0

set -e

run_wix() {
    cp $BUILD_DIR/catserver.exe $BUILD_DIR/HolyCluster.exe
    wix build \
        -d Version=$VERSION \
        -d CargoTargetBinDir=$BUILD_DIR wix/$WIX_NAME.wxs \
         -ext WixToolset.UI.wixext \
        -o "$BUILD_DIR/HolyCluster.msi"
    echo "MSI complied successfuly: $OUTPUT_PATH"
}

main() {
    if [ "$1" = "in-docker" ]; then
        run_wix
    else
        cargo build --target $TARGET --release
        docker run -v $(pwd):/work -w /work --rm ghcr.io/iarc-il/catserver-ci:latest $0 in-docker
    fi
}

main $@
