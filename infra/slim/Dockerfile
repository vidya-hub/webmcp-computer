FROM debian:bookworm-slim

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
    file \
    fonts-dejavu-core \
    git \
    iproute2 \
    libnotify-bin \
    novnc \
    openbox \
    pcmanfm \
    python3 \
    ripgrep \
    scrot \
    sudo \
    tigervnc-standalone-server \
    unzip \
    websockify \
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
  && if [ -f /usr/share/novnc/vnc.html ]; then ln -sf vnc.html /usr/share/novnc/index.html; fi

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

COPY infra/slim/openbox/menu.xml /etc/xdg/openbox/menu.xml
COPY infra/slim/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY infra/slim/session.sh /usr/local/bin/session.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/session.sh

ENV DISPLAY=:1 \
  PORT=8080

WORKDIR /opt/webmcp
USER root
EXPOSE 6901 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
