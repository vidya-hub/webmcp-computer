#!/usr/bin/env bash
set -u

if [ -f /opt/webmcp/bridge/src/index.ts ]; then
  (cd /opt/webmcp/bridge && npx tsx src/index.ts) >/tmp/bridge.log 2>&1 &
else
  node /opt/webmcp/bridge-stub/server.mjs >/tmp/bridge.log 2>&1 &
fi

if [ -n "${DISABLE_CUSTOM_STARTUP:-}" ]; then
  wait
  exit 0
fi

if [ -x /usr/bin/desktop_ready ]; then
  /usr/bin/desktop_ready
fi

export DISPLAY="${DISPLAY:-:1}"

WP_ID="${WALLPAPER:-carbon}"
WP="/usr/share/backgrounds/webmcp/${WP_ID}.png"

if command -v xfconf-query >/dev/null 2>&1 && [ -f "$WP" ]; then
  xfconf-query -c xfce4-desktop -l 2>/dev/null | grep -E 'last-image$|image-path$' | while read -r prop; do
    xfconf-query -c xfce4-desktop -p "$prop" -s "$WP" || true
  done
  xfconf-query -c xsettings -p /Net/ThemeName -s Adwaita-dark || true
  xfconf-query -c xfwm4 -p /general/theme -s Adwaita-dark || true
  xfdesktop --reload 2>/dev/null || true
fi

wait
