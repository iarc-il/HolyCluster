# Taken from: https://github.com/jkroepke/docker-wixtoolset
FROM rust:1.98.1@sha256:f31fa9eaac4e417505e10009786ec0c636558e02dff3fa662cc92c10894ba065

ARG DEBIAN_FRONTEND=noninteractive
ARG WINE_VERSION=10.0.0.0
ARG WINEHQ_KEY_SHA256=d965d646defe94b3dfba6d5b4406900ac6c81065428bf9d9303ad7a72ee8d1b8
ARG DOTNET_VERSION=9.0.300
# Version 5.0.2 is the latest version of WiX Toolset that does not require Open Source Maintenance Fee.
ARG WIXTOOLSET_VERSION=5.0.2
ARG WINETRICKS_COMMIT=f3890f670867b5ffbc3938726db45c0f7d16c8ba
ARG WINETRICKS_SHA256=672a1ff4442e8691a3ffc0e6860137e201a1d1227e9b3044245f1731e9e9837e
ARG LINUXDEPLOY_VERSION=1-alpha-20240109-1
ARG LINUXDEPLOY_SHA256=c86d6540f1df31061f02f539a2d3445f8d7f85cc3994eee1e74cd1ac97b76df0
ARG APPIMAGE_RUNTIME_SHA256=1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf

ENV WINEPATH="C:\\users\\wix\\.dotnet\\tools" \
    WINEPREFIX="/home/wix/.wine" \
    XDG_RUNTIME_DIR="/tmp/" \
    WINEARCH=win32 \
    WINEDEBUG=-all \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_GENERATE_ASPNET_CERTIFICATE=false

RUN set -ex \
    && dpkg --add-architecture i386 \
    && apt-get update -qq \
    && apt-get install --no-install-recommends -qqy \
        autoconf \
        automake \
        binutils-mingw-w64-x86-64 \
        build-essential \
        ca-certificates \
        curl \
        gcc-mingw-w64-x86-64-posix \
        g++-mingw-w64-x86-64-posix \
        libappindicator3-dev \
        libappindicator3-1 \
        libgtk-3-dev \
        libgtk-3-0 \
        imagemagick \
        libusb-1.0-0 \
        libusb-1.0-0-dev \
        libudev-dev \
        libxdo-dev \
        make \
        mingw-w64-x86-64-dev \
        p7zip-full \
        pkg-config \
        unzip \
        xauth \
        xvfb \
        xz-utils

RUN set -ex \
    && . /etc/os-release \
    && curl -sSfLo /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key \
    && printf '%s  %s\n' "$WINEHQ_KEY_SHA256" /etc/apt/keyrings/winehq-archive.key | sha256sum -c - \
    && printf 'Types: deb\nURIs: https://dl.winehq.org/wine-builds/debian\nSuites: %s\nComponents: main\nArchitectures: amd64 i386\nSigned-By: /etc/apt/keyrings/winehq-archive.key\n' "$VERSION_CODENAME" > /etc/apt/sources.list.d/winehq.sources \
    && apt-get update -qq

RUN set -ex \
    && . /etc/os-release \
    && apt-get install --no-install-recommends -qqy "wine-stable-amd64=$WINE_VERSION~$VERSION_CODENAME-1"

RUN set -ex \
    && . /etc/os-release \
    && apt-get install --no-install-recommends -qqy "wine-stable-i386:i386=$WINE_VERSION~$VERSION_CODENAME-1"

RUN set -ex \
    && . /etc/os-release \
    && apt-get install --no-install-recommends -qqy \
        "wine-stable=$WINE_VERSION~$VERSION_CODENAME-1" \
        "winehq-stable=$WINE_VERSION~$VERSION_CODENAME-1"

RUN set -ex \
    && curl -sSfLo /usr/local/bin/winetricks "https://raw.githubusercontent.com/Winetricks/winetricks/$WINETRICKS_COMMIT/src/winetricks" \
    && printf '%s  %s\n' "$WINETRICKS_SHA256" /usr/local/bin/winetricks | sha256sum -c - \
    && curl -sSfLo /usr/local/bin/linuxdeploy-x86_64.AppImage "https://github.com/linuxdeploy/linuxdeploy/releases/download/$LINUXDEPLOY_VERSION/linuxdeploy-x86_64.AppImage" \
    && printf '%s  %s\n' "$LINUXDEPLOY_SHA256" /usr/local/bin/linuxdeploy-x86_64.AppImage | sha256sum -c - \
    && mkdir -p /opt /usr/local/lib/appimage \
    && curl -sSfLo /usr/local/lib/appimage/runtime-x86_64 https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64 \
    && printf '%s  %s\n' "$APPIMAGE_RUNTIME_SHA256" /usr/local/lib/appimage/runtime-x86_64 | sha256sum -c - \
    && chmod +x /usr/local/bin/winetricks /usr/local/bin/linuxdeploy-x86_64.AppImage /usr/local/lib/appimage/runtime-x86_64 \
    && cd /tmp \
    && /usr/local/bin/linuxdeploy-x86_64.AppImage --appimage-extract >/dev/null \
    && mv squashfs-root/plugins/linuxdeploy-plugin-appimage/appimagetool-prefix /opt/appimagetool \
    && rm -rf squashfs-root \
    && ln -s /opt/appimagetool/AppRun /usr/local/bin/appimagetool \
    && useradd -m wix \
    && printf '#!/bin/sh\nexec wine dotnet $@' > /usr/local/bin/dotnet \
    && printf '#!/bin/sh\nexec wine wix.exe $@' > /usr/local/bin/wix \
    && chmod +x /usr/local/bin/dotnet /usr/local/bin/wix \
    && ln -s /usr/local/bin/wix /usr/local/bin/wix.exe

USER wix
WORKDIR /home/wix

RUN set -ex \
    && wineboot --init \
    && winetricks nocrashdialog \
    && curl -sSfLo /tmp/dotnet-sdk.exe "https://builds.dotnet.microsoft.com/dotnet/Sdk/$DOTNET_VERSION/dotnet-sdk-$DOTNET_VERSION-win-x86.exe" \
    && xvfb-run wine /tmp/dotnet-sdk.exe /q /norestart \
    && rm /tmp/dotnet-sdk.exe

RUN set -ex \
    && dotnet tool install --global wix --version "$WIXTOOLSET_VERSION" \
    && wine wix.exe --version \
    && wix extension add -g "WixToolset.Util.wixext/$WIXTOOLSET_VERSION" \
    && wix extension add -g "WixToolset.Firewall.wixext/$WIXTOOLSET_VERSION" \
    && wix extension add -g "WixToolset.UI.wixext/$WIXTOOLSET_VERSION"

RUN set -ex \
    && rustup target add x86_64-pc-windows-gnu \
    && rustup component add clippy rustfmt

USER root
WORKDIR /

RUN set -ex \
    && apt-get purge -y curl xauth xvfb xz-utils p7zip-full unzip \
    && apt-get clean -y \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

USER wix
WORKDIR /home/wix
