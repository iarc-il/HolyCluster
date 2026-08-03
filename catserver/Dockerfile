# Taken from: https://github.com/jkroepke/docker-wixtoolset
FROM rust

ARG DEBIAN_FRONTEND=noninteractive

ARG WINE_VERSION=10.0.0.0
ARG DOTNET_VERSION=9.0.300
# Version 5.0.2 is the latest version of WiX Toolset that does not require Open Source Maintenance Fee.
ARG WIXTOOLSET_VERSION=5.0.2

ENV WINEPATH="C:\\users\\wix\\.dotnet\\tools" \
    WINEPREFIX="/home/wix/.wine" \
    XDG_RUNTIME_DIR="/tmp/" \
    WINEARCH=win32 \
    WINEDEBUG=-all \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_GENERATE_ASPNET_CERTIFICATE=false

RUN set -ex \
    && set -o allexport && . /etc/os-release && set +o allexport \
    && dpkg --add-architecture i386 \
    && apt-get update -qq  \
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
        libgtk-3-dev \
        imagemagick \
        libusb-1.0-0 \
        libusb-1.0-0-dev \
        libxdo-dev \
        make \
        mingw-w64-x86-64-dev \
        p7zip-full \
        pkg-config \
        unzip \
        xauth \
        xvfb \
        xz-utils \
    && curl -sSfLo /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key \
    && curl -sSfLo /etc/apt/sources.list.d/winehq.sources https://dl.winehq.org/wine-builds/debian/dists/$VERSION_CODENAME/winehq-$VERSION_CODENAME.sources \
    && WINE_PACKAGE_VERSION="$WINE_VERSION~$VERSION_CODENAME-1" \
    && apt-get update -qq \
    && apt-get install --no-install-recommends -qqy \
        "winehq-stable=$WINE_PACKAGE_VERSION" \
        "wine-stable=$WINE_PACKAGE_VERSION" \
        "wine-stable-amd64=$WINE_PACKAGE_VERSION" \
        "wine-stable-i386:i386=$WINE_PACKAGE_VERSION" \
    && curl -sSfLo /usr/local/bin/winetricks https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks \
    && curl -sSfLo /usr/local/bin/linuxdeploy-x86_64.AppImage https://github.com/linuxdeploy/linuxdeploy/releases/download/1-alpha-20240109-1/linuxdeploy-x86_64.AppImage \
    && chmod +x /usr/local/bin/winetricks /usr/local/bin/linuxdeploy-x86_64.AppImage \
    && useradd -m wix \
    && printf '#!/bin/sh\nexec wine dotnet $@' > /usr/local/bin/dotnet \
    && printf '#!/bin/sh\nexec wine wix.exe $@' > /usr/local/bin/wix \
    && chmod +x /usr/local/bin/dotnet /usr/local/bin/wix \
    && ln -sf /usr/local/bin/wix /usr/local/bin/wix.exe

USER wix
WORKDIR /home/wix

RUN set -ex \
    && wineboot --init \
    && winetricks nocrashdialog \
    && curl -sSfLo /tmp/dotnet-sdk.exe https://builds.dotnet.microsoft.com/dotnet/Sdk/${DOTNET_VERSION}/dotnet-sdk-${DOTNET_VERSION}-win-x86.exe \
    && xvfb-run wine /tmp/dotnet-sdk.exe /q /norestart \
    && rm -rf /tmp/dotnet-sdk.exe \
    && dotnet tool install --global wix --version ${WIXTOOLSET_VERSION} \
    && wine wix.exe --version \
    && wix extension add -g WixToolset.Util.wixext/${WIXTOOLSET_VERSION} \
    && wix extension add -g WixToolset.Firewall.wixext/${WIXTOOLSET_VERSION} \
    && wix extension add -g WixToolset.UI.wixext/${WIXTOOLSET_VERSION} \
    # Rust stuff \
    && rustup default stable \
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
