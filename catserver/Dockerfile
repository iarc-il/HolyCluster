FROM ghcr.io/iarc-il/catserver-ci@sha256:16f279ff2e1619aff977936903f33ed6ebcef15e98a741a1744a3b18e2baa5f3

ARG DEBIAN_FRONTEND=noninteractive
ARG LINUXDEPLOY_VERSION=1-alpha-20240109-1
ARG LINUXDEPLOY_SHA256=c86d6540f1df31061f02f539a2d3445f8d7f85cc3994eee1e74cd1ac97b76df0
ARG APPIMAGE_RUNTIME_SHA256=1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf

USER root

RUN set -ex \
    && apt-get update -qq \
    && apt-get install --no-install-recommends -qqy curl libudev-dev \
    && curl -sSfLo /usr/local/bin/linuxdeploy-x86_64.AppImage "https://github.com/linuxdeploy/linuxdeploy/releases/download/$LINUXDEPLOY_VERSION/linuxdeploy-x86_64.AppImage" \
    && printf '%s  %s\n' "$LINUXDEPLOY_SHA256" /usr/local/bin/linuxdeploy-x86_64.AppImage | sha256sum -c - \
    && mkdir -p /opt /usr/local/lib/appimage \
    && curl -sSfLo /usr/local/lib/appimage/runtime-x86_64 https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64 \
    && printf '%s  %s\n' "$APPIMAGE_RUNTIME_SHA256" /usr/local/lib/appimage/runtime-x86_64 | sha256sum -c - \
    && chmod +x /usr/local/bin/linuxdeploy-x86_64.AppImage /usr/local/lib/appimage/runtime-x86_64 \
    && cd /tmp \
    && /usr/local/bin/linuxdeploy-x86_64.AppImage --appimage-extract >/dev/null \
    && rm -rf /opt/appimagetool \
    && mv squashfs-root/plugins/linuxdeploy-plugin-appimage/appimagetool-prefix /opt/appimagetool \
    && rm -rf squashfs-root \
    && ln -sfn /opt/appimagetool/AppRun /usr/local/bin/appimagetool \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*

USER wix
WORKDIR /home/wix
