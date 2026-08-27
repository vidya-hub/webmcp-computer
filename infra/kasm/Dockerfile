ARG KASM_TAG=1.16.1
FROM kasmweb/core-ubuntu-jammy:${KASM_TAG}
USER root

ENV HOME=/home/kasm-default-profile
ENV STARTUPDIR=/dockerstartup
ENV INST_SCRIPTS=$STARTUPDIR/install
WORKDIR $HOME

######### Customize Container Here ###########

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-dejavu-core \
    git \
    imagemagick \
    python3 \
    software-properties-common \
    xdotool \
    xfconf \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

# Chromium from Debian bookworm (Ubuntu's package is a snap stub).
RUN mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://ftp-master.debian.org/keys/archive-key-12.asc \
    -o /etc/apt/keyrings/debian-archive-key-12.asc \
  && echo "deb [signed-by=/etc/apt/keyrings/debian-archive-key-12.asc] http://deb.debian.org/debian bookworm main" \
    > /etc/apt/sources.list.d/debian-bookworm.list \
  && printf 'Package: *\nPin: release a=bookworm\nPin-Priority: 100\n\nPackage: chromium*\nPin: release a=bookworm\nPin-Priority: 500\n' \
    > /etc/apt/preferences.d/debian-bookworm \
  && apt-get update \
  && apt-get install -y --no-install-recommends chromium \
  && rm -f /etc/apt/sources.list.d/debian-bookworm.list \
    /etc/apt/preferences.d/debian-bookworm \
    /etc/apt/keyrings/debian-archive-key-12.asc \
  && apt-get update \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /etc/chromium/policies/managed /etc/chromium.d \
  && printf '%s\n' '{"CommandLineFlagSecurityWarningsEnabled": false, "DefaultBrowserSettingEnabled": false}' \
    > /etc/chromium/policies/managed/default_managed_policy.json \
  && printf '%s\n' 'export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir=/home/kasm-user/.config/chromium --no-first-run --no-default-browser-check"' \
    > /etc/chromium.d/webmcp \
  && rm -f \
    /etc/xdg/autostart/chromium*.desktop \
    /etc/xdg/autostart/firefox*.desktop \
    /etc/xdg/autostart/google-chrome*.desktop \
    "$HOME/.config/autostart/"chromium*.desktop \
    "$HOME/.config/autostart/"firefox*.desktop \
    "$HOME/.config/autostart/"google-chrome*.desktop \
  || true

# Node 22 (official tarball).
RUN NODE_VER=22.14.0 \
  && ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in amd64) NARCH=x64 ;; arm64) NARCH=arm64 ;; *) NARCH=x64 ;; esac \
  && curl -fsSL "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-${NARCH}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 \
  && node -v && npm -v

COPY infra/kasm/generate-wallpapers.sh /tmp/generate-wallpapers.sh
RUN chmod +x /tmp/generate-wallpapers.sh && /tmp/generate-wallpapers.sh && rm /tmp/generate-wallpapers.sh

COPY infra/kasm/project $HOME/project
RUN cd "$HOME/project" && npm install \
  && chown -R 1000:0 "$HOME/project"

COPY packages/contract /opt/webmcp/contract
COPY apps/bridge /opt/webmcp/bridge
COPY infra/kasm/bridge-stub /opt/webmcp/bridge-stub
RUN cd /opt/webmcp/bridge \
  && node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.dependencies['@webmcp-computer/contract']='file:../contract'; p.dependencies.tsx=(p.devDependencies&&p.devDependencies.tsx)||'4.19.3'; delete p.devDependencies; fs.writeFileSync('package.json', JSON.stringify(p,null,2));" \
  && npm install \
  && chmod -R a+rX /opt/webmcp

COPY infra/kasm/custom_startup.sh $STARTUPDIR/custom_startup.sh
RUN chmod +x $STARTUPDIR/custom_startup.sh

EXPOSE 6901 8080

######### End Customizations ###########

RUN chown 1000:0 $HOME
RUN $STARTUPDIR/set_user_permission.sh $HOME

ENV HOME=/home/kasm-user
WORKDIR $HOME
RUN mkdir -p $HOME && chown -R 1000:0 $HOME

USER 1000
