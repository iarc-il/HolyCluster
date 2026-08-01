#!/bin/bash
set -e

TARGET=x86_64-pc-windows-gnu
BUILD_DIR=target/$TARGET/release
WIX_NAME=main
DIALOG_NAME=CustomInstallDirDlg
OUTPUT_PATH=$BUILD_DIR/HolyCluster.msi
DEFAULT_SHORTCUT_ARGUMENTS=${DEFAULT_SHORTCUT_ARGUMENTS:-}

GIT_TAG=$(git describe --match 'catserver-v*')
BASE_VERSION=$(echo $GIT_TAG | sed -rn 's/catserver-v([.0-9]*)(-.*)?/\1/p')
BUGFIX_VERSION=$(echo $BASE_VERSION | sed -rn "s/[0-9]*\.[0-9]*\.([0-9]*)/\1/p")
MAJOR_AND_MINOR_VERSION=$(echo $BASE_VERSION | sed -rn "s/([0-9]*\.[0-9]*).*/\1/p")
SUB_VERSION=$(echo $GIT_TAG | sed -rn 's/catserver-v[.0-9]*-(.*)-.*/\1/p')
SUB_VERSION=${SUB_VERSION:-0}
NEW_BUGFIX_VERSION=$(( SUB_VERSION * 10 + BUGFIX_VERSION ))
VERSION=$MAJOR_AND_MINOR_VERSION.$NEW_BUGFIX_VERSION

run_wix() {
    cp $BUILD_DIR/catserver.exe $BUILD_DIR/HolyCluster.exe
    wix build \
        -d Version=$VERSION \
        -d CargoTargetBinDir=$BUILD_DIR \
        -d DefaultShortcutArguments="$DEFAULT_SHORTCUT_ARGUMENTS" \
        wix/$WIX_NAME.wxs \
        -ext WixToolset.UI.wixext \
        -o "$BUILD_DIR/HolyCluster.msi"
    echo "MSI complied successfuly (version $VERSION): $OUTPUT_PATH"
}

main() {
    if [ "$1" = "in-docker" ]; then
        shift
        while [ "$#" -gt 0 ]; do
            case "$1" in
                --default-shortcut-arguments=*)
                    DEFAULT_SHORTCUT_ARGUMENTS="${1#*=}"
                    ;;
                --default-shortcut-arguments)
                    shift
                    if [ "$#" -eq 0 ]; then
                        echo "Missing value for --default-shortcut-arguments" >&2
                        exit 1
                    fi
                    DEFAULT_SHORTCUT_ARGUMENTS="$1"
                    ;;
                *)
                    echo "Unknown argument: $1" >&2
                    exit 1
                    ;;
            esac
            shift
        done
        run_wix
    else
        docker run -v "$(pwd)/..:/work" -w /work/catserver --rm ghcr.io/iarc-il/catserver-ci:latest "$0" in-docker "$@"
    fi
}

main "$@"
