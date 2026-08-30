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

# Seed per-user desktop config. Idempotent: entrypoint.sh renames the uid-1000
# user and home on every boot, so this must run here, not at image build time.
SKEL=/usr/share/webmcp/skel
WP_PATH="/usr/share/backgrounds/webmcp/${WP}.png"
[ -f "$WP_PATH" ] || WP_PATH="/usr/share/backgrounds/webmcp/carbon.png"

if [ -d "$SKEL" ]; then
  mkdir -p "$HOME/.config" "$HOME/Desktop"
  cp -rn "$SKEL/config/." "$HOME/.config/" 2>/dev/null || true
  [ -f "$SKEL/.Xresources" ] && cp -n "$SKEL/.Xresources" "$HOME/.Xresources" 2>/dev/null || true
  [ -f "$SKEL/.gtkrc-2.0" ] && cp -n "$SKEL/.gtkrc-2.0" "$HOME/.gtkrc-2.0" 2>/dev/null || true
  [ -d "$SKEL/project" ] && cp -rn "$SKEL/project" "$HOME/" 2>/dev/null || true
  # Launchers live on the tint2 panel, not the wallpaper.
  for name in Chromium Files Project Terminal; do
    rm -f "$HOME/Desktop/${name}.desktop"
  done
  # Drop Project from older tint2 configs that still pin it.
  if [ -f "$HOME/.config/tint2/tint2rc" ]; then
    sed -i '/launchers\/Project\.desktop/d' "$HOME/.config/tint2/tint2rc" || true
  fi
  DESK_CONF="$HOME/.config/pcmanfm/default/desktop-items-0.conf"
  [ -f "$DESK_CONF" ] && sed -i "s|@WALLPAPER_PATH@|$WP_PATH|g" "$DESK_CONF"
fi

if [ -f "$HOME/.Xresources" ] && command -v xrdb >/dev/null 2>&1; then
  xrdb -merge "$HOME/.Xresources" || true
fi
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true

if [ -f /etc/xdg/openbox/menu.xml ]; then
  cp /etc/xdg/openbox/menu.xml "$HOME/.config/openbox/menu.xml"
fi

openbox >/tmp/openbox.log 2>&1 &

if command -v picom >/dev/null 2>&1; then
  picom -b --log-file /tmp/picom.log || picom -b >/tmp/picom.log 2>&1 || true
fi

if command -v tint2 >/dev/null 2>&1; then
  tint2 -c "$HOME/.config/tint2/tint2rc" >/tmp/tint2.log 2>&1 &
fi

if command -v pcmanfm >/dev/null 2>&1; then
  pcmanfm --desktop --profile=default >/tmp/pcmanfm.log 2>&1 &
else
  xterm -geometry 80x24+40+40 >/tmp/xterm.log 2>&1 &
fi

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

# Product H.264 path (Selkies 2.x, websockets only). Parent remains VNC_PID.
if command -v selkies >/dev/null 2>&1; then
  selkies \
    --addr=0.0.0.0 \
    --port=6902 \
    --mode=websockets \
    --enable-dual-mode=false \
    --enable-https=false \
    --enable-basic-auth=true \
    --basic-auth-user=selkies \
    --basic-auth-password="${MACHINE_TOKEN}" \
    --encoder=h264enc \
    --use-cpu=true \
    --enable-resize=false \
    --manual-width=1280 \
    --manual-height=800 \
    --framerate=24 \
    --video-bitrate=2500 \
    --audio-enabled=false \
    --microphone-enabled=false \
    --webcam-enabled=false \
    --gamepad-enabled=false \
    --file-transfers=none \
    --enable-sharing=false \
    --command-enabled=false \
    --enable-clipboard=true \
    --ui-show-sidebar=false \
    --ui-show-core-buttons=false \
    >/tmp/selkies.log 2>&1 &
fi


while kill -0 "$VNC_PID" 2>/dev/null; do
  sleep 2
done
exit 1
