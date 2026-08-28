# deploy/ — Oracle host deployment (data services)

Data-layer config for running webmcp-computer on the Oracle host. The action tape
moves from flat files to **Postgres** (event metadata) + **MinIO** (before/after PNGs).

## Postgres (dedicated)
    cd ~/homelab/webmcp-computer
    cp deploy/.env.example deploy/.env    # set POSTGRES_PASSWORD + DATABASE_URL
    docker compose -f deploy/compose.postgres.yml --env-file deploy/.env up -d
Schema in `db/001_init.sql` is applied automatically on first init.
Bound to `127.0.0.1:55432`.

## MinIO (reuse svg-emb-minio)
    MINIO_ROOT_USER=... MINIO_ROOT_PASSWORD=... ./deploy/minio-setup.sh
Creates bucket `webmcp-computer` + a scoped service account; paste the printed
keys into `deploy/.env` (S3_ACCESS_KEY / S3_SECRET_KEY).

## Env
See `.env.example`. Real `deploy/.env` is gitignored.
