#!/bin/bash

TARGET=x86_64-pc-windows-gnu
BUILD_DIR=target/$TARGET/release
WIX_NAME=main
DIALOG_NAME=CustomInstallDirDlg
OUTPUT_PATH=$BUILD_DIR/HolyCluster.msi

set -e

run_wix() {
    cp $BUILD_DIR/catserver.exe $BUILD_DIR/HolyCluster.exe
    candle -dVersion=0.1.0 -dCargoTargetBinDir=$BUILD_DIR wix/$WIX_NAME.wxs -o "$BUILD_DIR/"
    candle -dVersion=0.1.0 -dCargoTargetBinDir=$BUILD_DIR wix/$DIALOG_NAME.wxs -o "$BUILD_DIR/"
    light -ext WixUIExtension -sval $BUILD_DIR/$WIX_NAME.wixobj $BUILD_DIR/$DIALOG_NAME.wixobj -o "$OUTPUT_PATH"
    echo "MSI complied successfuly: $OUTPUT_PATH"
}

main() {
    if [ "$1" = "in-docker" ]; then
        run_wix
    else
        cargo build --target $TARGET --release
        docker run -v $(pwd):/wix --rm fleetdm/wix $0 in-docker
    fi
}

main $@
