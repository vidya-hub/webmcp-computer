#!/usr/bin/env bash
set -u
cd /

RAW="${LINUX_USER:-${MACHINE_ID:-computer}}"
NAME="$(printf '%s' "$RAW" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-' | cut -c1-32)"
if [ -z "$NAME" ]; then
  NAME=computer
fi
case "$NAME" in
  [0-9]*) NAME="u-${NAME}" ;;
esac

CURRENT="$(getent passwd 1000 | cut -d: -f1)"
if [ -n "$CURRENT" ] && [ "$CURRENT" != "$NAME" ]; then
  usermod -l "$NAME" "$CURRENT" 2>/dev/null || true
  usermod -d "/home/$NAME" -m "$NAME" 2>/dev/null || mkdir -p "/home/$NAME"
elif ! id "$NAME" >/dev/null 2>&1; then
  useradd -m -u 1000 -s /bin/bash "$NAME"
fi

export HOME="/home/$NAME"
export USER="$NAME"
export HOME_JAIL="$HOME"
mkdir -p "$HOME/.config/chromium"
chown -R 1000:1000 "$HOME"

# 4G ext4 image for $HOME so df/Files show a few GB, not the 98G VM overlay.
setup_home_quota() {
  command -v fuse2fs >/dev/null 2>&1 || return 0
  command -v mkfs.ext4 >/dev/null 2>&1 || return 0
  [ -e /dev/fuse ] || return 0
  local img=/var/lib/webmcp/home.img
  local mnt=/var/lib/webmcp/home
  local size="${WEBMCP_DISK_BYTES:-4294967296}"
  mkdir -p /var/lib/webmcp "$mnt"
  if [ ! -f "$img" ]; then
    truncate -s "$size" "$img" || return 0
    mkfs.ext4 -F -q -L webmcp-home -m 1 "$img" || return 0
  fi
  if ! grep -q " ${mnt} " /proc/mounts 2>/dev/null; then
    fuse2fs -o rw,fakeroot,allow_other "$img" "$mnt" || return 0
  fi
  if [ ! -f "$mnt/.webmcp-quota" ]; then
    cp -a "$HOME"/. "$mnt"/ 2>/dev/null || true
    touch "$mnt/.webmcp-quota"
  fi
  chown -R 1000:1000 "$mnt" || true
  if ! grep -q " ${HOME} " /proc/mounts 2>/dev/null; then
    mount --bind "$mnt" "$HOME" || return 0
  fi
}
setup_home_quota || true

printf '%s\n' "export CHROMIUM_FLAGS=\"\$CHROMIUM_FLAGS --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir=${HOME}/.config/chromium --no-first-run --no-default-browser-check\"" \
  > /etc/chromium.d/webmcp

exec runuser -u "$NAME" -- env HOME="$HOME" USER="$NAME" HOME_JAIL="$HOME" MACHINE_ID="${MACHINE_ID:-}" MACHINE_NAME="${MACHINE_NAME:-}" WALLPAPER="${WALLPAPER:-carbon}" WEBMCP_MEMORY_BYTES="${WEBMCP_MEMORY_BYTES:-}" WEBMCP_DISK_BYTES="${WEBMCP_DISK_BYTES:-}" DISPLAY="${DISPLAY:-:1}" PORT="${PORT:-8080}" /usr/local/bin/session.sh
