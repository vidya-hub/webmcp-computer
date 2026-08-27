# CODING AGENT PROMPT — copy everything below this line

You are a coding agent. Implement ONLY the desktop images of WebMCP Computer.

Project root: `/Users/vidyasagar/ProjectSpace/webmcp_exp/webmcp-computer`

Read `plans/ARCHITECTURE.md`, `plans/CONTRACT.md`, wallpaper table in `plans/DESIGN.md`. Do not edit them, `packages/contract`, or `apps/**`.

## Hard rules

- Own `infra/kasm/**` only.
- Two containers, one image, env `MACHINE_ID=nova|forge`.
- Visible Chromium is the CDP target. No second browser.
- Do not volume-mount host `node_modules`.
- When finished: list files changed and how to verify this phase only.

## Goal

`infra/kasm/compose.yaml`:

```
nova  127.0.0.1:6901→vnc  127.0.0.1:8081→8080  MACHINE_ID=nova  wallpaper carbon
forge 127.0.0.1:6902→vnc  127.0.0.1:8082→8080  MACHINE_ID=forge  wallpaper dark-grid
shm-size 512m
```

Base `kasmweb/core-ubuntu-jammy:1.16.1` (fallback tag in CONTRACT).

Image:

1. Chromium, Node 22, git, python3, `xdotool`, `xfconf-query`, ImageMagick, JetBrains Mono optional.
2. Replace existing browser autostart with Chromium flags from CONTRACT. Confirm with `ps` inside the container there is one chromium, not two.
3. `/usr/share/backgrounds/webmcp/{void,carbon,dark-grid,arrows}.png` 1920x1080, ImageMagick, no gradient.
4. `/home/kasm-user/project` Vite app, `npm install` in the image, `dev` script as CONTRACT.
5. `infra/kasm/bridge-stub/` Node script: `GET /health`, `POST /act` for `{op:"snapshot"}` fake ComputerState using `MACHINE_ID`. Other ops 501. Compose runs this on 8080 until integrate COPY the real bridge.
6. README: compose command, login (default `kasm_user` / `password` or whatever the base image actually uses), URLs.

`docker compose -f infra/kasm/compose.yaml up --build`

## Done when

Two VNC logins. XFCE on each. One Chromium window. From **inside** nova: `curl -s 127.0.0.1:9222/json/version` works. `/home/kasm-user/project/package.json` exists. Host `curl -s 127.0.0.1:8081/health` hits the stub.
