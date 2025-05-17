# Taken from: https://github.com/jkroepke/docker-wixtoolset
FROM rust

ARG DEBIAN_FRONTEND=noninteractive

ARG WINE_VERSION=10.0.0.0~bookworm-1
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
    && apt-get install --no-install-recommends ca-certificates curl xauth xvfb xz-utils p7zip-full unzip -qqy \
    && curl -sSfLo /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key \
    && curl -sSfLo /etc/apt/sources.list.d/winehq.sources https://dl.winehq.org/wine-builds/debian/dists/$VERSION_CODENAME/winehq-$VERSION_CODENAME.sources \
    && apt-get update -qq && apt-get install --no-install-recommends winehq-stable=${WINE_VERSION} -qqy \
    && curl -sSfLo /usr/local/bin/winetricks https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks \
    && chmod +x /usr/local/bin/winetricks \
    && useradd -m wix \
    && apt-get clean autoclean && apt-get autoremove --yes && rm -rf /var/lib/{apt,dpkg,cache,log}/ \
    && printf '#!/bin/sh\nexec wine dotnet $@' > /usr/local/bin/dotnet \
    && printf '#!/bin/sh\nexec wine wix.exe $@' > /usr/local/bin/wix \
    && chmod +x /usr/local/bin/dotnet /usr/local/bin/wix \
    && ln -sf /usr/local/bin/wix /usr/local/bin/wix.exe \
    # Needed for \
    && apt-get install -y \
    libgtk-3-dev \
    libxdo-dev \
    libappindicator3-dev \
    binutils-mingw-w64-x86-64 \
    gcc-mingw-w64-x86-64-win32

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
