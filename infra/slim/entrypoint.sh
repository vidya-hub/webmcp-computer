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

printf '%s\n' "export CHROMIUM_FLAGS=\"\$CHROMIUM_FLAGS --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir=${HOME}/.config/chromium --no-first-run --no-default-browser-check\"" \
  > /etc/chromium.d/webmcp

exec runuser -u "$NAME" -- env HOME="$HOME" USER="$NAME" HOME_JAIL="$HOME" MACHINE_ID="${MACHINE_ID:-}" MACHINE_NAME="${MACHINE_NAME:-}" WALLPAPER="${WALLPAPER:-carbon}" DISPLAY="${DISPLAY:-:1}" PORT="${PORT:-8080}" /usr/local/bin/session.sh
