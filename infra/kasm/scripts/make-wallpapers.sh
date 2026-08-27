#!/usr/bin/env bash
set -euo pipefail
OUT="${1:-/usr/share/backgrounds/webmcp}"
mkdir -p "$OUT"

convert -size 1920x1080 xc:'#000000' "$OUT/void.png"
convert -size 1920x1080 xc:'#111111' "$OUT/carbon.png"

convert -size 32x32 xc:'#000000' -stroke '#202020' -strokewidth 1 \
  -fill none -draw 'line 0,0 31,0' -draw 'line 0,0 0,31' /tmp/grid-cell.png
convert -size 1920x1080 tile:/tmp/grid-cell.png "$OUT/dark-grid.png"

convert -size 24x22 xc:'#000000' -fill '#3a3a3a' -pointsize 16 \
  -gravity center -annotate +0+0 '>' /tmp/gt.png
convert -size 1920x1080 tile:/tmp/gt.png "$OUT/arrows.png"
