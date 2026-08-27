# Kasm desktops (Nova / Forge)

Two XFCE desktops from one image. Env `MACHINE_ID=nova|forge` picks wallpaper (`carbon` / `dark-grid`).

## Run

From the repo root:

```
docker compose -f infra/kasm/compose.yaml up --build
```

If `kasmweb/core-ubuntu-jammy:1.16.1` cannot be pulled, rebuild with the fallback tag:

```
docker compose -f infra/kasm/compose.yaml build --build-arg KASM_TAG=1.17.0
docker compose -f infra/kasm/compose.yaml up
```

## Login

KasmVNC (HTTPS, self-signed — accept the warning):

| Machine | URL | User | Password |
|---------|-----|------|----------|
| Nova | https://127.0.0.1:6901 | `kasm_user` | `password` |
| Forge | https://127.0.0.1:6902 | `kasm_user` | `password` |

`VNC_PW=password` is set in compose (the password the base image actually uses).

## Check

Host:

```
curl -s 127.0.0.1:8081/health
curl -s 127.0.0.1:8082/health
```

Inside Nova (terminal on the desktop):

```
curl -s 127.0.0.1:9222/json/version
ls /home/kasm-user/project/package.json
ps aux | grep -i chromium
```

Expect one Chromium process tree, CDP on `127.0.0.1:9222`, seed project present.

Bridge stub answers `GET /health` and `POST /act` `{ "op": "snapshot" }` only. Other ops return 501 until integrate copies the real bridge.
