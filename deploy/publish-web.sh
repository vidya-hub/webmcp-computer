#!/usr/bin/env bash
# Build the web app and publish it to the nginx web root.
# Usage: deploy/publish-web.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_ROOT="${WEB_ROOT:-/var/www/computer.vsagar.net}"

cd "$REPO_ROOT"

# Prefer pnpm on PATH; fall back to corepack (which ships with Node).
if command -v pnpm >/dev/null 2>&1; then
  PNPM="pnpm"
else
  PNPM="corepack pnpm"
fi

echo "==> building @webmcp-computer/web"
$PNPM --filter @webmcp-computer/web build

echo "==> publishing to $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rsync -a --delete apps/web/dist/ "$WEB_ROOT/"

echo "==> done. index.html is served no-cache; /assets/* are immutable."
