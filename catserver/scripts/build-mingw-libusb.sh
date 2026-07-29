#!/bin/sh
set -eu

. "$(dirname "$0")/windows-runtime-metadata.sh"
: "${HAMLIB_LIBUSB_PREFIX:?set HAMLIB_LIBUSB_PREFIX to the target libusb install path}"

archive="${TMPDIR:-/tmp}/libusb-${LIBUSB_VERSION}.tar.bz2"
source="${TMPDIR:-/tmp}/libusb-${LIBUSB_VERSION}"

cleanup() {
    rm -rf "$archive" "$source"
}

trap cleanup EXIT HUP INT TERM

curl -sSfLo "$archive" "$LIBUSB_SOURCE_URL"
printf '%s  %s\n' "$LIBUSB_SHA256" "$archive" | sha256sum -c -
tar -xjf "$archive" -C "${TMPDIR:-/tmp}"

cd "$source"
CC=x86_64-w64-mingw32-gcc \
CXX=x86_64-w64-mingw32-g++ \
AR=x86_64-w64-mingw32-ar \
RANLIB=x86_64-w64-mingw32-ranlib \
DLLTOOL=x86_64-w64-mingw32-dlltool \
WINDRES=x86_64-w64-mingw32-windres \
./configure --host=x86_64-w64-mingw32 --prefix="$HAMLIB_LIBUSB_PREFIX" --disable-static --enable-shared
make -j"$(nproc)"
make install
install -Dm644 COPYING "$HAMLIB_LIBUSB_PREFIX/share/licenses/libusb/COPYING"
printf 'libusb %s\nLicense: %s\nSource: %s\nSHA-256: %s\n' \
    "$LIBUSB_VERSION" "$LIBUSB_LICENSE" "$LIBUSB_SOURCE_URL" "$LIBUSB_SHA256" \
    > "$HAMLIB_LIBUSB_PREFIX/share/licenses/libusb/NOTICE.txt"

test -f "$HAMLIB_LIBUSB_PREFIX/include/libusb-1.0/libusb.h"
test -f "$HAMLIB_LIBUSB_PREFIX/lib/libusb-1.0.dll.a"
test -f "$HAMLIB_LIBUSB_PREFIX/bin/libusb-1.0.dll"
