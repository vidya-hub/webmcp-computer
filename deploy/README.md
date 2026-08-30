# deploy/ — Oracle host deployment

WebMCP Computer runs on the Oracle host with five moving parts. **Access is
tailnet-only** (see §5): the control plane is unauthenticated, so it must never
be exposed on a public port.

```
browser ──https──▶ tailscale serve ──▶ nginx 127.0.0.1:8091 ──▶ SPA + /api,/desktops ▶ API :8787
                                                                          │
                                          docker (webmcp-slim desktops) ◀─┤
                                          Postgres :55432 ◀───────────────┤
                                          MinIO :9000 ◀────────────────────┘
```

## 1. API control plane (systemd)

    sudo cp deploy/webmcp-api.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now webmcp-api

Runs `tsx apps/api/src/index.ts` on `127.0.0.1:8787`, `Restart=always`,
`HOST_BACKEND=docker` (fails fast if Docker/image is missing rather than serving
a fake in-memory host). Reads `deploy/.env`. Logs: `journalctl -u webmcp-api -f`.

## 2. Web app publish

    deploy/publish-web.sh            # builds apps/web and rsyncs to /var/www/computer.vsagar.net

No auto-deploy — run this after changing the frontend. `index.html` is served
`no-cache`; hashed `/assets/*` are `immutable`.

## 3. nginx

Two vhosts in `deploy/nginx/` (copy to `/etc/nginx/conf.d/`, `sudo nginx -t &&
sudo systemctl reload nginx`):

- `computer-tailscale.conf` — `127.0.0.1:8091`, the real app listener (Tailscale
  proxies here). gzip + asset caching + WebSocket upgrade + 3600s proxy timeouts
  for the approval hold and VNC streams.
- `computer.vsagar.net.conf` — public `:80`, now returns **404** for everything
  (the control plane must not be public). Delete it to close the port entirely.

`00-websocket-upgrade.conf` provides the `$connection_upgrade` map (keep it).

## 4. Postgres + MinIO (tape / recipes / archives)

    cp deploy/.env.example deploy/.env     # set POSTGRES_PASSWORD, DATABASE_URL, ALLOWED_ORIGINS
    docker compose -f deploy/compose.postgres.yml --env-file deploy/.env up -d
    MINIO_ROOT_USER=... MINIO_ROOT_PASSWORD=... ./deploy/minio-setup.sh   # bucket + scoped keys

`db/001_init.sql` (tape) runs on first init. `db/002_actions_archives.sql`
documents the recipe + archive tables; the API also creates them at boot via
`ensureSchema()`, so no manual migration is needed. MinIO holds tape screenshots
(`<computer>/<event>-{before,after}.png`) and home archives (`homes/<id>.tar.gz`).

## 5. Tailscale Serve (the only ingress)

    tailscale serve --bg --https=443 http://127.0.0.1:8091

Serves `https://vidyaoracle.tailc57b59.ts.net` to the tailnet only (TLS
terminated by tailscaled). Set that origin in `ALLOWED_ORIGINS` in `deploy/.env`
or the app's own POSTs will be rejected by the CSRF guard.

## 6. Docker log rotation (host-wide — review first)

`deploy/daemon.json` is a **reference snippet**. This host shares Docker with
other services; merge its keys into any existing `/etc/docker/daemon.json`, then
`sudo systemctl reload docker`. Do not blindly overwrite the file.

## Env

See `.env.example` (real `deploy/.env` is gitignored, `chmod 600`). Notable:
`HOST_BACKEND`, `ALLOWED_ORIGINS`, `STORAGE_BACKEND`, `MAX_COMPUTERS`.
`MACHINE_TOKEN` is generated per desktop at spawn — not configured here.


## 7. Guest image and display

Rebuild after changing `infra/slim`:

    docker build -t webmcp-slim:local -f infra/slim/Dockerfile .

Desktops publish **loopback only**: `127.0.0.1:0:6901` (noVNC), `127.0.0.1:0:6902` (Selkies H.264), `127.0.0.1:0:8080` (bridge). The browser never talks to a container. The API injects `Basic selkies:${MACHINE_TOKEN}` toward `:6902` and Origin-checks `/desktops` (HTTP + WS) with `frame-ancestors 'self'`. Do not publish guest ports on `0.0.0.0`. Existing computers keep the old image until destroy/respawn.
