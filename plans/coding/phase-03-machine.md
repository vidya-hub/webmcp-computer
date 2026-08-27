# CODING AGENT PROMPT — copy everything below this line

You are a coding agent. Implement ONLY the machine module of WebMCP Computer.

Project root: `/Users/vidyasagar/ProjectSpace/webmcp_exp/webmcp-computer`

Read `plans/ARCHITECTURE.md` and `plans/CONTRACT.md`. Do not edit them or `packages/contract`.

## Hard rules

- TypeScript. Avoid `any`.
- Own `apps/bridge/**` only.
- `@webmcp-computer/contract` for `Machine`, `MachineOp`, `dispatch`, `isDetachedCommand`. Do not implement approval.
- Hono. `POST /act` and `GET /health`. Listen `0.0.0.0:${PORT:-8080}`.
- No React. No Docker build.
- When finished: list files changed and how to verify this phase only.

Env: `MACHINE_ID`, `MACHINE_NAME`, `DISPLAY` default `:1`, `CDP_URL` default `http://127.0.0.1:9222`, `HOME_JAIL` default `/home/kasm-user`, `ALLOW_JSON_APPEARANCE`.

If `HOME_JAIL` does not exist, create it only when `ALLOW_JSON_APPEARANCE=1` (laptop). Otherwise 500 on file ops.

## Goal

Package `@webmcp-computer/bridge`. Class/object that implements `Machine`. `POST /act` → `dispatch(machine, op)`.

**Jail:** `fs.realpath` / resolve. Path must stay under jail. 400 `{ error: "path outside jail" }`. Read cap 256KB. Write creates parents.

**snapshot:** hostname, uptime, cpu one sample, memory strings like `1.2GB`/`4GB`, disk via `df`, foreground `xdotool` or `"unknown"`, `browserStatus` from CDP `/json/version`.

**run:** `posix` shell, cwd default jail. If `isDetachedCommand(command)`: spawn detached (`detached: true`, `stdio` piped), return when stdout matches `/Local:\\s|listening|ready/i` or 8s, `{ exitCode: null, running: true, pid, stdout }`. Else wait, timeout 30s, kill on timeout, return exitCode/stdout/stderr.

**appearance GET:** query xfconf backdrop + gtk theme; map file basename to `WallpaperId` and dark/light. If xfconf missing and `ALLOW_JSON_APPEARANCE=1`, read `$JAIL/.webmcp-appearance.json`. If xfconf missing and `/.dockerenv` exists, throw.

**setWallpaper / setTheme:** set every xfce4-desktop backdrop property you can list for that DISPLAY; gtk/xfce theme Adwaita-dark vs Adwaita. Then re-read. Docker without xfconf → throw. Laptop with `ALLOW_JSON_APPEARANCE=1` may write json.

**browser / openUrl:** CDP `/json/list`, page targets only. `openUrl` attaches to the existing page websocket, `Page.navigate`. No `spawn` of Chromium. CDP down: `browser()` → `{ activeTab: null, tabs: [] }` 200. `openUrl` → 502 `{ error: "browser not running" }`.

`pnpm --filter @webmcp-computer/bridge dev`

## Done when

```
ALLOW_JSON_APPEARANCE=1 HOME_JAIL=$PWD/tmp-jail PORT=8080 MACHINE_ID=nova MACHINE_NAME=Nova pnpm --filter @webmcp-computer/bridge dev
curl -s -X POST localhost:8080/act -H 'content-type: application/json' -d '{"op":"writeFile","path":".../tmp-jail/hello.txt","content":"hi"}'
curl -s -X POST localhost:8080/act -d '{"op":"readFile","path":"..."}'
curl -s -X POST localhost:8080/act -d '{"op":"run","command":"ls","cwd":"<jail>"}'
curl -s -X POST localhost:8080/act -d '{"op":"browser"}'
```

write/read round-trip. `ls` exit 0. browser empty 200. `run` `npm run dev` is not required on the laptop if no project exists; unit-test detach with `command: "npm run dev"` mocked or a tiny node `--watch` if you can. At least cover `isDetachedCommand` branch with a `node -e "setInterval(()=>{},1000)"` only if you also treat that as detached in a test helper — do not expand policy. Prefer a fixture `package.json` `"dev": "node -e \"console.log('ready'); setInterval(()=>{},1e9)\""` inside the jail and `npm run dev` as the detach test.
