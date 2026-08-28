#!/usr/bin/env bash
set -u
export DISPLAY="${DISPLAY:-:1}"
export HOME="${HOME:-/home/kasm-user}"
export USER="${USER:-$(id -un)}"
export HOME_JAIL="${HOME_JAIL:-$HOME}"
cd "$HOME" || cd /

mkdir -p "$HOME/.vnc" "$HOME/.config/openbox" "$HOME/.config/chromium"

GEOM="${VNC_GEOMETRY:-1280x800}"
DEPTH="${VNC_DEPTH:-24}"

VNC_BIN="$(command -v Xtigervnc || command -v Xvnc || true)"
if [ -z "$VNC_BIN" ]; then
  echo "no Xvnc" >&2
  exit 1
fi
"$VNC_BIN" "$DISPLAY" \
  -geometry "$GEOM" \
  -depth "$DEPTH" \
  -rfbport 5901 \
  -localhost yes \
  -SecurityTypes None \
  -AlwaysShared \
  >/tmp/vnc.log 2>&1 &
VNC_PID=$!

for _ in $(seq 1 80); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

WP="${WALLPAPER:-carbon}"
case "$WP" in
  void) COLOR="#000000" ;;
  dark-grid) COLOR="#202020" ;;
  arrows) COLOR="#3a3a3a" ;;
  *) COLOR="#111111" ;;
esac
xsetroot -solid "$COLOR" || true

if [ -f /etc/xdg/openbox/menu.xml ]; then
  cp /etc/xdg/openbox/menu.xml "$HOME/.config/openbox/menu.xml"
fi

openbox >/tmp/openbox.log 2>&1 &
xterm -geometry 80x24+40+40 >/tmp/xterm.log 2>&1 &

if [ -f /opt/webmcp/bridge/dist/index.js ]; then
  node /opt/webmcp/bridge/dist/index.js >/tmp/bridge.log 2>&1 &
else
  node /opt/webmcp/bridge-stub/server.mjs >/tmp/bridge.log 2>&1 &
fi

NOVNC=/usr/share/novnc
if [ -f "$NOVNC/vnc.html" ] && [ ! -e "$NOVNC/index.html" ]; then
  ln -sf vnc.html "$NOVNC/index.html"
fi

websockify --web="$NOVNC" 0.0.0.0:6901 127.0.0.1:5901 >/tmp/websockify.log 2>&1 &

while kill -0 "$VNC_PID" 2>/dev/null; do
  sleep 2
done
exit 1
