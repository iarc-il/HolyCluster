#!/bin/bash
set -e

TARGET=x86_64-pc-windows-gnu
BUILD_DIR=target/$TARGET/release
WIX_NAME=main
DIALOG_NAME=CustomInstallDirDlg
OUTPUT_PATH=$BUILD_DIR/HolyCluster.msi
VERSION=$(git describe --match 'catserver-v*' | sed -rn 's/.*v(.*)-(.*)-.*/\1.\2/p')

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
        cargo build --target $TARGET --release
        docker run -v $(pwd)/..:/work -w /work/catserver --rm ghcr.io/iarc-il/catserver-ci:latest $0 in-docker
    fi
}

main $@
