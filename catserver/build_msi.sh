#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

TARGET=x86_64-pc-windows-gnu
CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-target}
BUILD_DIR=$CARGO_TARGET_DIR/$TARGET/release
WIX_NAME=main
OUTPUT_PATH=$BUILD_DIR/HolyCluster.msi
DEFAULT_SHORTCUT_ARGUMENTS=${DEFAULT_SHORTCUT_ARGUMENTS:-}
CI_IMAGE=${CATSERVER_CI_IMAGE:-ghcr.io/iarc-il/catserver-ci@sha256:16f279ff2e1619aff977936903f33ed6ebcef15e98a741a1744a3b18e2baa5f3}

GIT_TAG=$(git describe --match 'catserver-v*')
if [[ $GIT_TAG =~ ^catserver-v([0-9]+)\.([0-9]+)\.[0-9]+(-[0-9]+-g[0-9a-f]+)?$ ]]; then
    MAJOR_VERSION=${BASH_REMATCH[1]}
    MINOR_VERSION=${BASH_REMATCH[2]}
else
    echo "Invalid catserver version: $GIT_TAG" >&2
    exit 1
fi
if [[ $(git rev-parse --is-shallow-repository) == true ]]; then
    echo "A complete Git history is required to derive the MSI version" >&2
    exit 1
fi
COMMIT_COUNT=$(git rev-list --count HEAD)
MSI_VERSION_MIGRATION_SCALE=10
MSI_BUILD_VERSION=$((10#$COMMIT_COUNT * MSI_VERSION_MIGRATION_SCALE))
if ((10#$MAJOR_VERSION > 255 || 10#$MINOR_VERSION > 255 || MSI_BUILD_VERSION > 65535)); then
    echo "MSI version is out of range: $MAJOR_VERSION.$MINOR_VERSION.$MSI_BUILD_VERSION" >&2
    exit 1
fi
VERSION=$((10#$MAJOR_VERSION)).$((10#$MINOR_VERSION)).$MSI_BUILD_VERSION

SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct HEAD)}
if [[ ! $SOURCE_DATE_EPOCH =~ ^[0-9]+$ ]]; then
    echo "Invalid SOURCE_DATE_EPOCH: $SOURCE_DATE_EPOCH" >&2
    exit 1
fi
export SOURCE_DATE_EPOCH TZ=UTC LC_ALL=C.UTF-8

run_wix() {
    local executable=$BUILD_DIR/HolyCluster.exe
    local intermediate=$BUILD_DIR/wix-intermediate
    local product_identity
    local product_code
    local package_code

    cp -- "$BUILD_DIR/catserver.exe" "$executable"
    touch -d "@$SOURCE_DATE_EPOCH" "$executable"
    product_identity=$(
        {
            printf '%s\0' 'HolyCluster' "$VERSION" "$DEFAULT_SHORTCUT_ARGUMENTS"
            sha256sum "$executable" "wix/$WIX_NAME.wxs" wix/icon.ico wix/eula.rtf | cut -d ' ' -f 1
        } | sha256sum | cut -d ' ' -f 1
    )
    product_code=$(python3 tools/reproducible_msi.py guid "$product_identity")
    rm -rf -- "$intermediate"
    mkdir -p -- "$intermediate"
    wix build \
        -d Version="$VERSION" \
        -d ProductCode="$product_code" \
        -d CargoTargetBinDir="$BUILD_DIR" \
        -d DefaultShortcutArguments="$DEFAULT_SHORTCUT_ARGUMENTS" \
        "wix/$WIX_NAME.wxs" \
        -ext WixToolset.UI.wixext \
        -intermediatefolder "$intermediate" \
        -pdbtype none \
        -o "$OUTPUT_PATH"
    package_code=$(python3 tools/reproducible_msi.py normalize "$OUTPUT_PATH" "$SOURCE_DATE_EPOCH")
    touch -d "@$SOURCE_DATE_EPOCH" "$OUTPUT_PATH"
    rm -rf -- "$intermediate"
    echo "MSI compiled successfully (version $VERSION, product $product_code, package $package_code): $OUTPUT_PATH"
}

main() {
    if [[ ${1:-} == in-docker ]]; then
        shift
        while (($# > 0)); do
            case "$1" in
                --default-shortcut-arguments=*)
                    DEFAULT_SHORTCUT_ARGUMENTS=${1#*=}
                    ;;
                --default-shortcut-arguments)
                    shift
                    if (($# == 0)); then
                        echo "Missing value for --default-shortcut-arguments" >&2
                        exit 1
                    fi
                    DEFAULT_SHORTCUT_ARGUMENTS=$1
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
        local repository
        local docker_environment=()
        repository=$(git rev-parse --show-toplevel)
        if [[ -v SOURCE_DATE_EPOCH ]]; then
            docker_environment+=(-e "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH")
        fi
        docker run \
            --mount "type=bind,src=$repository,dst=/work" \
            -w /work/catserver \
            --rm \
            "${docker_environment[@]}" \
            "$CI_IMAGE" \
            ./build_msi.sh in-docker "$@"
    fi
}

main "$@"
