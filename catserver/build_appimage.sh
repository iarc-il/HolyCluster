#!/bin/sh
set -eu

umask 022

TARGET=x86_64-unknown-linux-gnu
CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-target}
BUILD_DIR=$CARGO_TARGET_DIR/$TARGET/release
APPDIR=$BUILD_DIR/AppDir
LINUXDEPLOY=${LINUXDEPLOY:-/usr/local/bin/linuxdeploy-x86_64.AppImage}
APPIMAGETOOL=${APPIMAGETOOL:-/usr/local/bin/appimagetool}
APPIMAGE_RUNTIME=${APPIMAGE_RUNTIME:-/usr/local/lib/appimage/runtime-x86_64}
VERSION=${CATSERVER_VERSION:-$(git describe --match 'catserver-v*')}
SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct HEAD)}
OUTPUT=$BUILD_DIR/$VERSION-linux-x86_64.AppImage
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

case "$VERSION" in
    catserver-v*) ;;
    *)
        printf 'Invalid catserver version: %s\n' "$VERSION" >&2
        exit 1
        ;;
esac
case "$SOURCE_DATE_EPOCH" in
    ''|*[!0-9]*)
        printf 'Invalid SOURCE_DATE_EPOCH: %s\n' "$SOURCE_DATE_EPOCH" >&2
        exit 1
        ;;
esac
if [ ! -x "$APPIMAGETOOL" ]; then
    printf 'AppImage tool is not executable: %s\n' "$APPIMAGETOOL" >&2
    exit 1
fi
if [ ! -f "$APPIMAGE_RUNTIME" ]; then
    printf 'AppImage runtime is missing: %s\n' "$APPIMAGE_RUNTIME" >&2
    exit 1
fi
export SOURCE_DATE_EPOCH TZ=UTC LC_ALL=C.UTF-8

find_appindicator_library() {
    if [ -n "${APPINDICATOR_LIBRARY:-}" ] && [ -f "$APPINDICATOR_LIBRARY" ]; then
        readlink -f "$APPINDICATOR_LIBRARY"
        return
    fi

    for candidate in \
        /usr/lib/*/libayatana-appindicator3.so.1 \
        /lib/*/libayatana-appindicator3.so.1 \
        /usr/lib/*/libappindicator3.so.1 \
        /lib/*/libappindicator3.so.1
    do
        if [ -f "$candidate" ]; then
            readlink -f "$candidate"
            return
        fi
    done
}

find_libusb_library() {
    if [ -n "${LIBUSB_LIBRARY:-}" ] && [ -f "$LIBUSB_LIBRARY" ]; then
        readlink -f "$LIBUSB_LIBRARY"
        return
    fi

    for candidate in \
        /usr/lib/*/libusb-1.0.so.0 \
        /lib/*/libusb-1.0.so.0 \
        /usr/lib/libusb-1.0.so.0 \
        /lib/libusb-1.0.so.0
    do
        if [ -f "$candidate" ]; then
            readlink -f "$candidate"
            return
        fi
    done
}

APPINDICATOR_LIBRARY=$(find_appindicator_library)
if [ -z "$APPINDICATOR_LIBRARY" ]; then
    printf '%s\n' 'Could not find libayatana-appindicator3.so.1 or libappindicator3.so.1' >&2
    exit 1
fi
APPINDICATOR_FILENAME=$(basename "$APPINDICATOR_LIBRARY")
LIBUSB_LIBRARY=$(find_libusb_library)
if [ -z "$LIBUSB_LIBRARY" ]; then
    printf '%s\n' 'Could not find libusb-1.0.so.0' >&2
    exit 1
fi
LIBUSB_FILENAME=$(basename "$LIBUSB_LIBRARY")

rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin"
install -m 755 "$BUILD_DIR/catserver" "$APPDIR/usr/bin/HolyCluster"
install -m 644 "$SCRIPT_DIR/appimage/HolyCluster.desktop" "$APPDIR/HolyCluster.desktop"
convert "$SCRIPT_DIR/../ui/src/assets/icon.png" -resize '128x128!' -strip "$APPDIR/HolyCluster.png"
chmod 644 "$APPDIR/HolyCluster.png"
cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
APPDIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
export LD_LIBRARY_PATH="$APPDIR/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$APPDIR/usr/bin/HolyCluster" "$@"
EOF
chmod +x "$APPDIR/AppRun"

mkdir -p "$APPDIR/usr/lib"
cp -L "$APPINDICATOR_LIBRARY" "$APPDIR/usr/lib/$APPINDICATOR_FILENAME"
ln -sf "$APPINDICATOR_FILENAME" "$APPDIR/usr/lib/libayatana-appindicator3.so.1"
ln -sf "$APPINDICATOR_FILENAME" "$APPDIR/usr/lib/libappindicator3.so.1"
cp -L "$LIBUSB_LIBRARY" "$APPDIR/usr/lib/$LIBUSB_FILENAME"
ln -sf "$LIBUSB_FILENAME" "$APPDIR/usr/lib/libusb-1.0.so.0"

ARCH=x86_64 "$LINUXDEPLOY" --appimage-extract-and-run \
    --appdir "$APPDIR" \
    --executable "$APPDIR/usr/bin/HolyCluster" \
    --library "$APPINDICATOR_LIBRARY" \
    --library "$LIBUSB_LIBRARY" \
    --desktop-file "$APPDIR/HolyCluster.desktop" \
    --icon-file "$APPDIR/HolyCluster.png"

for library in libayatana-appindicator3.so.1 libappindicator3.so.1 libusb-1.0.so.0; do
    if [ ! -e "$APPDIR/usr/lib/$library" ]; then
        printf 'AppImage is missing %s\n' "$library" >&2
        exit 1
    fi
done
find "$APPDIR" -type d -exec chmod 755 {} +
find "$APPDIR" -type f -exec chmod 644 {} +
chmod 755 "$APPDIR/AppRun" "$APPDIR/usr/bin/HolyCluster"
find "$APPDIR" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +
rm -f "$OUTPUT"
env -u SOURCE_DATE_EPOCH ARCH=x86_64 "$APPIMAGETOOL" \
    --runtime-file "$APPIMAGE_RUNTIME" \
    --comp gzip \
    --mksquashfs-opt=-all-time \
    --mksquashfs-opt="$SOURCE_DATE_EPOCH" \
    --mksquashfs-opt=-processors \
    --mksquashfs-opt=1 \
    --mksquashfs-opt=-no-xattrs \
    "$APPDIR" \
    "$OUTPUT"
touch -d "@$SOURCE_DATE_EPOCH" "$OUTPUT"
