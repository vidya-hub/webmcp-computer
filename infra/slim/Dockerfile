# Selkies 2.x (pixelflux). GitHub releases/latest is still 1.6.2 GStreamer — do not use it.
FROM ghcr.io/selkies-project/selkies/base@sha256:90d7a14739b0ba985145b02f0e1e325e7c5bd82dade5673a33a6b1a8f4deea21 AS selkies
FROM debian:trixie-slim

RUN printf '%s\n' \
    'path-exclude=/usr/share/doc/*' \
    'path-exclude=/usr/share/man/*' \
    'path-exclude=/usr/share/locale/*' \
    > /etc/dpkg/dpkg.cfg.d/excludes

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    curl \
    e2fsprogs \
    fuse3 \
    fuse2fs \
    file \
    fonts-dejavu-core \
    git \
    iproute2 \
    libnotify-bin \
    novnc \
    openbox \
    pcmanfm \
    picom \
    python3 \
    libdrm2 \
    libgbm1 \
    libva2 \
    libva-drm2 \
    libva-x11-2 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcb-dri3-0 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libpixman-1-0 \
    libexpat1 \
    ripgrep \
    scrot \
    sudo \
    tigervnc-standalone-server \
    tint2 \
    unzip \
    websockify \
    wmctrl \
    x11-utils \
    x11-xserver-utils \
    xdotool \
    xterm \
    xz-utils \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /etc/chromium/policies/managed /etc/chromium.d \
  && printf '%s\n' '{"CommandLineFlagSecurityWarningsEnabled": false, "DefaultBrowserSettingEnabled": false}' \
    > /etc/chromium/policies/managed/default_managed_policy.json \
  && printf '%s\n' 'export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --no-first-run --no-default-browser-check"' \
    > /etc/chromium.d/webmcp \
  && if [ -f /usr/share/novnc/vnc.html ]; then ln -sf vnc.html /usr/share/novnc/index.html; fi \
  && mv /usr/bin/pcmanfm /usr/bin/pcmanfm.real

RUN NODE_VER=22.14.0 \
  && ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in amd64) NARCH=x64 ;; arm64) NARCH=arm64 ;; *) NARCH=x64 ;; esac \
  && curl -fsSL "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-${NARCH}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 \
  && rm -rf /usr/local/include /usr/local/share/doc /usr/local/share/man \
  && apt-get purge -y xz-utils \
  && apt-get autoremove -y \
  && node -v && npm -v

RUN useradd -m -u 1000 -s /bin/bash kasm-user \
  && mkdir -p /home/kasm-user/.config/openbox /opt/webmcp \
  && usermod -aG sudo kasm-user \
  && printf '%s\n' '%sudo ALL=(root) NOPASSWD: /usr/bin/apt-get' \
    > /etc/sudoers.d/webmcp-apt \
  && chmod 440 /etc/sudoers.d/webmcp-apt

COPY packages/contract /opt/webmcp/contract
COPY apps/bridge /opt/webmcp/bridge
COPY infra/kasm/bridge-stub /opt/webmcp/bridge-stub
RUN cd /opt/webmcp/bridge \
  && node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.dependencies['@webmcp-computer/contract']='file:../contract'; fs.writeFileSync('package.json', JSON.stringify({name:p.name,type:'module',dependencies:p.dependencies},null,2));" \
  && npm install --omit=dev \
  && npx --yes esbuild@0.24.2 src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.js \
  && rm -rf node_modules \
    /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
  && chmod -R a+rX /opt/webmcp \
  && chown -R 1000:1000 /home/kasm-user /opt/webmcp

COPY infra/slim/pcmanfm-wrapper.sh /usr/bin/pcmanfm
COPY infra/slim/openbox/menu.xml /etc/xdg/openbox/menu.xml
COPY infra/slim/openbox/themes /usr/share/themes
COPY infra/slim/assets /tmp/webmcp-assets
RUN set -eu \
  && chmod 755 /usr/bin/pcmanfm \
  && for f in terminal files chromium project; do \
       test -f "/tmp/webmcp-assets/icons/$f.png" \
       || { echo "missing asset: infra/slim/assets/icons/$f.png — see infra/slim/assets/IMAGEGEN_HANDOVER.md" >&2; exit 1; }; \
     done \
  && for f in Terminal Files Chromium; do \
       test -f "/tmp/webmcp-assets/launchers/${f}.desktop" \
       || { echo "missing launcher: infra/slim/assets/launchers/${f}.desktop" >&2; exit 1; }; \
     done \
  && for f in void carbon dark-grid arrows; do \
       test -f "/tmp/webmcp-assets/wallpapers/$f.png" \
       || { echo "missing asset: infra/slim/assets/wallpapers/$f.png — see infra/slim/assets/IMAGEGEN_HANDOVER.md" >&2; exit 1; }; \
     done \
  && test -f /tmp/webmcp-assets/bin/webmcp-launch \
       || { echo "missing infra/slim/assets/bin/webmcp-launch" >&2; exit 1; } \
  && test -f /tmp/webmcp-assets/bin/webmcp-df \
       || { echo "missing infra/slim/assets/bin/webmcp-df" >&2; exit 1; } \
  && mkdir -p /usr/share/backgrounds/webmcp /usr/share/webmcp/icons \
       /usr/share/webmcp/launchers /usr/share/webmcp/bin \
  && cp /tmp/webmcp-assets/wallpapers/*.png /usr/share/backgrounds/webmcp/ \
  && cp /tmp/webmcp-assets/icons/*.png /usr/share/webmcp/icons/ \
  && if [ -f /tmp/webmcp-assets/icons/terminal.xpm ]; then \
       cp /tmp/webmcp-assets/icons/terminal.xpm /usr/share/webmcp/icons/; \
     fi \
  && cp /tmp/webmcp-assets/launchers/*.desktop /usr/share/webmcp/launchers/ \
  && chmod 644 /usr/share/webmcp/launchers/*.desktop \
  && cp /tmp/webmcp-assets/bin/webmcp-launch /usr/share/webmcp/bin/webmcp-launch \
  && chmod 755 /usr/share/webmcp/bin/webmcp-launch \
  && cp /tmp/webmcp-assets/bin/webmcp-df /usr/local/bin/df \
  && chmod 755 /usr/local/bin/df \
  && if [ -f /etc/fuse.conf ]; then \
       grep -q '^user_allow_other' /etc/fuse.conf \
         || printf '\nuser_allow_other\n' >> /etc/fuse.conf; \
     else \
       printf 'user_allow_other\n' > /etc/fuse.conf; \
     fi \
  && { test -f /usr/share/icons/hicolor/48x48/apps/chromium.png \
       || test -f /usr/share/pixmaps/chromium.png \
       || { echo "missing packaged chromium icon" >&2; exit 1; }; } \
  && cp -r /tmp/webmcp-assets/skel /usr/share/webmcp/skel \
  && mkdir -p /usr/share/fonts/truetype/inter /usr/share/fonts/truetype/jetbrains-mono \
  && if ls /tmp/webmcp-assets/fonts/inter/*.ttf >/dev/null 2>&1; then \
       cp /tmp/webmcp-assets/fonts/inter/*.ttf /usr/share/fonts/truetype/inter/; \
     else \
       echo "warning: Inter fonts missing from infra/slim/assets/fonts/inter/" >&2; \
     fi \
  && if ls /tmp/webmcp-assets/fonts/jetbrains-mono/*.ttf >/dev/null 2>&1; then \
       cp /tmp/webmcp-assets/fonts/jetbrains-mono/*.ttf /usr/share/fonts/truetype/jetbrains-mono/; \
     else \
       echo "warning: JetBrains Mono missing from infra/slim/assets/fonts/jetbrains-mono/" >&2; \
     fi \
  && fc-cache -f \
  && if [ -d /tmp/webmcp-assets/cursors/capitaine-cursors/cursors ]; then \
       mkdir -p /usr/share/icons; \
       cp -a /tmp/webmcp-assets/cursors/capitaine-cursors /usr/share/icons/; \
     else \
       echo "warning: capitaine-cursors missing from infra/slim/assets/cursors/" >&2; \
     fi \
  && mkdir -p /usr/share/icons/Webmcp \
  && if [ -f /tmp/webmcp-assets/file-icons/theme/index.theme ]; then \
       cp -a /tmp/webmcp-assets/file-icons/theme/. /usr/share/icons/Webmcp/; \
     else \
       echo "warning: Webmcp icon theme index.theme missing" >&2; \
     fi \
  && for name in folder inode-directory user-home user-desktop computer drive-harddisk \
       user-trash network-workgroup text-x-generic application-x-executable \
       image-x-generic audio-x-generic video-x-generic application-pdf \
       application-x-archive go-previous go-next go-up go-home view-refresh \
       system-search edit-cut edit-copy edit-paste edit-delete folder-new \
       document-new tab-new; do \
       if ! find /usr/share/icons/Webmcp -name "${name}.png" 2>/dev/null | grep -q .; then \
         echo "warning: missing Webmcp icon: ${name}.png — see infra/slim/assets/IMAGEGEN_HANDOVER.md (GTK will fall back)" >&2; \
       fi; \
     done \
  && mkdir -p /usr/share/themes/Adwaita/gtk-3.0 \
  && printf '%s\n' \
       '@import url("resource:///org/gtk/libgtk/theme/Adwaita/gtk-contained.css");' \
       '@import url("file:///usr/share/webmcp/skel/config/gtk-3.0/gtk.css");' \
       > /usr/share/themes/Adwaita/gtk-3.0/gtk.css \
  && printf '%s\n' \
       '@import url("resource:///org/gtk/libgtk/theme/Adwaita/gtk-contained-dark.css");' \
       '@import url("file:///usr/share/webmcp/skel/config/gtk-3.0/gtk-dark.css");' \
       > /usr/share/themes/Adwaita/gtk-3.0/gtk-dark.css \
  && chmod -R a+rX /usr/share/backgrounds/webmcp /usr/share/webmcp \
      /usr/share/themes/WebmcpDark /usr/share/themes/WebmcpLight \
      /usr/share/themes/Adwaita /usr/share/icons/Webmcp \
      /usr/share/fonts/truetype/inter /usr/share/fonts/truetype/jetbrains-mono \
  && chown 1000:1000 /usr/share/webmcp/launchers \
  && if [ -d /usr/share/icons/capitaine-cursors ]; then chmod -R a+rX /usr/share/icons/capitaine-cursors; fi \
  && rm -rf /tmp/webmcp-assets
COPY infra/slim/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY infra/slim/session.sh /usr/local/bin/session.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/session.sh
COPY --from=selkies /usr/local/lib/python3.13/dist-packages /usr/local/lib/python3.13/dist-packages
COPY --from=selkies /usr/local/bin/selkies /usr/local/bin/selkies
COPY --from=selkies /usr/local/bin/selkies-resize /usr/local/bin/selkies-resize
COPY --from=selkies /usr/local/bin/selkies-gpu-probe /usr/local/bin/selkies-gpu-probe
RUN python3 -c "import pixelflux, selkies" \
  && selkies --help 2>&1 | grep -q -- '--mode' \
  || { echo "selkies is not 2.x (missing --mode); do not use GitHub releases/latest v1.6.2" >&2; exit 1; }

ENV DISPLAY=:1 \
  PORT=8080

WORKDIR /opt/webmcp
USER root
EXPOSE 6901 6902 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
