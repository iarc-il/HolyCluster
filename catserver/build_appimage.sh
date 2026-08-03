#!/bin/sh
set -eu

TARGET=x86_64-unknown-linux-gnu
CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-target}
BUILD_DIR=$CARGO_TARGET_DIR/$TARGET/release
APPDIR=$BUILD_DIR/AppDir
LINUXDEPLOY=${LINUXDEPLOY:-linuxdeploy-x86_64.AppImage}
VERSION=$(git describe --match 'catserver-v*')
OUTPUT=$BUILD_DIR/$VERSION-linux-x86_64.AppImage
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin"
cp "$BUILD_DIR/catserver" "$APPDIR/usr/bin/HolyCluster"
cp "$SCRIPT_DIR/appimage/HolyCluster.desktop" "$APPDIR/HolyCluster.desktop"
cp "$SCRIPT_DIR/../ui/src/assets/icon.png" "$APPDIR/HolyCluster.png"
cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
exec "$(dirname "$0")/usr/bin/HolyCluster" "$@"
EOF
chmod +x "$APPDIR/AppRun"

ARCH=x86_64 "$LINUXDEPLOY" --appimage-extract-and-run \
    --appdir "$APPDIR" \
    --executable "$APPDIR/usr/bin/HolyCluster" \
    --desktop-file "$APPDIR/HolyCluster.desktop" \
    --icon-file "$APPDIR/HolyCluster.png" \
    --output appimage
mv HolyCluster-x86_64.AppImage "$OUTPUT"
