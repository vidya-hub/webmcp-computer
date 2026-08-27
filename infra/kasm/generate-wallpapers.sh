#!/bin/bash
set -euo pipefail
OUT=/usr/share/backgrounds/webmcp
mkdir -p "$OUT"

convert -size 1920x1080 xc:'#000000' "$OUT/void.png"
convert -size 1920x1080 xc:'#111111' "$OUT/carbon.png"

convert -size 32x32 xc:'#000000' -fill '#202020' \
  -draw 'line 0,0 31,0' -draw 'line 0,0 0,31' /tmp/webmcp-grid.png
convert -size 1920x1080 tile:/tmp/webmcp-grid.png "$OUT/dark-grid.png"

FONT=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
convert -size 48x48 xc:'#000000' -fill '#3a3a3a' -font "$FONT" -pointsize 28 \
  -gravity center -annotate +0+0 '>' /tmp/webmcp-arrow.png
convert -size 1920x1080 tile:/tmp/webmcp-arrow.png "$OUT/arrows.png"

rm -f /tmp/webmcp-grid.png /tmp/webmcp-arrow.png
