# CODING AGENT PROMPT — copy everything below this line

You are a coding agent. Implement ONLY integrate for WebMCP Computer.

Project root: `/Users/vidyasagar/ProjectSpace/webmcp_exp/webmcp-computer`

Read `plans/ARCHITECTURE.md` demo path. Do not add tools. Do not restyle Axiom.

## Hard rules

- You may edit compose, Docker COPY of `apps/bridge`, Vite proxy, control-plane desktop proxy, `DISPLAY`/xfconf probing in the bridge, Chromium autostart, and README run steps.
- Do not invent features. Do not edit `packages/contract` unless a type is actually wrong; if so, stop and say so.
- When finished: list files changed and how to run the demo path.

## Goal

Make the four tracks run as one origin and survive the demo.

1. **Bridge in the image.** Dockerfile COPY `apps/bridge`, `pnpm install`/`npm install` **inside the image**, run the real Hono bridge on 8080. Delete reliance on the stub for the happy path. No Mac volume mount of `node_modules`.
2. **Same-origin VNC.** Workspace iframes `/desktops/nova/` and `/desktops/forge/` show the live sessions (websocket, path rewrite, cookies). If Kasm refuses to frame, fix proxy headers / Kasm env, not the iframe origin.
3. **DISPLAY / xfconf.** `setWallpaper dark-grid` on Nova changes the XFCE wallpaper the human sees. Failure throws, it does not 200 a json lie.
4. **CDP is that Chromium.** `openUrl http://127.0.0.1:5173` navigates the window on the VNC, after `npm run dev` detach in `/home/kasm-user/project`.
5. **Approval.** `act` `rm -rf` something jailed opens the Axiom dialog; Reject returns the contract reason to the tool; Approve runs it.
6. **Select.** Agent `select_computer forge` moves Ember border, unregisters Nova machine tools, registers Forge’s.
7. Root README: `pnpm` dev for web+api, `docker compose` for desktops, Chrome flag, sample ChatGPT prompts from the demo path. Judge URL is `http://127.0.0.1:5173`.

## Done when

You have run (or scripted) the ARCHITECTURE demo path against two containers and the workspace page. Write `plans/INTEGRATE_LOG.md` with commands, DISPLAY value, CDP `json/version` snippet, and anything still broken.
