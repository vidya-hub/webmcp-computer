#!/usr/bin/env bash
# Create the webmcp-computer bucket + a scoped service account on the existing
# svg-emb-minio instance. Requires the MinIO ROOT creds (passed via env) ONCE.
# Usage:
#   MINIO_ROOT_USER=... MINIO_ROOT_PASSWORD=... ./deploy/minio-setup.sh
# Prints the new S3_ACCESS_KEY / S3_SECRET_KEY to paste into deploy/.env
set -euo pipefail

: "${MINIO_ROOT_USER:?set MINIO_ROOT_USER}"
: "${MINIO_ROOT_PASSWORD:?set MINIO_ROOT_PASSWORD}"
ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:9000}"
BUCKET="${S3_BUCKET:-webmcp-computer}"
MC_IMAGE="${MC_IMAGE:-minio/mc:RELEASE.2025-04-16T18-13-26Z}"

docker run --rm --network host \
  -e MC_ROOT_USER="$MINIO_ROOT_USER" \
  -e MC_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
  -e ENDPOINT="$ENDPOINT" -e BUCKET="$BUCKET" \
  --entrypoint /bin/sh "$MC_IMAGE" -c '
    set -e
    mc alias set t "$ENDPOINT" "$MC_ROOT_USER" "$MC_ROOT_PASSWORD" >/dev/null
    mc mb -p "t/$BUCKET" 2>/dev/null || true
    # scoped policy: full access to just this bucket
    cat > /tmp/pol.json <<POL
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:*"],"Resource":["arn:aws:s3:::'"$BUCKET"'","arn:aws:s3:::'"$BUCKET"'/*"]}]}
POL
    mc admin policy create t webmcp-computer-rw /tmp/pol.json 2>/dev/null || true
    OUT=$(mc admin user svcacct add t "$MC_ROOT_USER" --policy /tmp/pol.json)
    echo "$OUT"
  '
echo
echo ">> Paste the Access Key / Secret Key above into deploy/.env as S3_ACCESS_KEY / S3_SECRET_KEY"
