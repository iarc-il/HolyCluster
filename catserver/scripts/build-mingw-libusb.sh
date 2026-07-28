#!/bin/sh
set -eu

LIBUSB_VERSION=${LIBUSB_VERSION:-1.0.30}
LIBUSB_SHA256=${LIBUSB_SHA256:-fea36f34f9156400209595e300840767ab1a385ede1dc7ee893015aea9c6dbaf}
LIBUSB_SOURCE_URL=${LIBUSB_SOURCE_URL:-https://github.com/libusb/libusb/releases/download/v1.0.30/libusb-1.0.30.tar.bz2}
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

test -f "$HAMLIB_LIBUSB_PREFIX/include/libusb-1.0/libusb.h"
test -f "$HAMLIB_LIBUSB_PREFIX/lib/libusb-1.0.dll.a"
test -f "$HAMLIB_LIBUSB_PREFIX/bin/libusb-1.0.dll"
