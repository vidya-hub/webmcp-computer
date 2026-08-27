# Contract

Source of truth for types and policy: `packages/contract/src/index.ts`. This file is the HTTP, env, and tool mapping around that package. Do not add fields the package does not have.

Project root: `/Users/vidyasagar/ProjectSpace/webmcp_exp/webmcp-computer`

Leave `../webmcp-todo`, `../webmcp-board`, `../agent-outpost` alone.

## Stack

pnpm. TypeScript. React 19 + Vite. Hono (locked). Node bridge. JetBrains Mono. `usewebmcp` + `@mcp-b/webmcp-polyfill`. `@webmcp-computer/contract`.

No in-app LLM. No click/screenshot tools. No `computerId` on machine tools or on `POST /api/act`.

## Ports (host)

| What | Bind |
|------|------|
| Workspace (only origin the browser uses) | `127.0.0.1:5173` |
| Control plane | `127.0.0.1:8787` |
| Nova VNC (proxied, do not iframe this from the page) | `127.0.0.1:6901` |
| Forge VNC | `127.0.0.1:6902` |
| Nova bridge (API only) | `127.0.0.1:8081` |
| Forge bridge | `127.0.0.1:8082` |
| CDP | container `127.0.0.1:9222` only |

## Control plane HTTP

```
GET  /health
GET  /api/computers
GET  /api/workspace
POST /api/workspace/select     { computerId }   header x-actor
POST /api/act                  MachineOp        header x-actor
POST /api/approvals/:id/approve
POST /api/approvals/:id/reject
GET  /api/ws
ALL  /desktops/nova/*          → 127.0.0.1:6901
ALL  /desktops/forge/*         → 127.0.0.1:6902
```

`POST /api/act` body is `MachineOp`. No computer id. Uses the selected computer.

409 `{ error: "no computer selected" }` if none.
404 `{ error: "unknown computer" }` on bad select.
502 `{ error: "bridge unreachable" }` when the HttpMachine adapter fails.
400 `{ error: "path outside jail" }` from the machine, passed through.

`POST /api/act` with `op: "run"` and `requiresApproval(command)` does not return until approve, reject, or 120s. Reject body:

```json
{ "exitCode": 1, "stdout": "", "stderr": "", "reason": "User rejected the operation." }
```

Timeout body: `reason: "Approval timed out."`

Read ops (`snapshot`, `listFiles`, `readFile`, `appearance`, `browser`) do not append activity. All others do.

## Bridge HTTP

```
GET  /health
POST /act                      MachineOp
```

Env: `MACHINE_ID`, `MACHINE_NAME`, `PORT` default 8080, `DISPLAY` default `:1`, `CDP_URL` default `http://127.0.0.1:9222`, `HOME_JAIL` default `/home/kasm-user`, `ALLOW_JSON_APPEARANCE` default unset.

## Vite proxy (`apps/web`)

```
/api        → http://127.0.0.1:8787  (ws: true)
/desktops   → http://127.0.0.1:8787  (ws: true)
```

Page fetch paths: `/api/workspace`, `/api/act`, … never a host:port.

Iframe src: `/desktops/nova/` and `/desktops/forge/`.

## WebMCP

Always on: `list_computers`, `get_workspace_state`, `select_computer`.

While a computer is selected, mount the rest (unmount on change, same as `webmcp-board` SelectedCardTools):

| Tool | act / route |
|------|-------------|
| `computer_get_state` | `{ op: "snapshot" }` |
| `computer_list_files` | `{ op: "listFiles", path }` default path `/home/kasm-user` |
| `computer_read_file` | `{ op: "readFile", path }` |
| `computer_write_file` | `{ op: "writeFile", path, content }` |
| `computer_run_command` | `{ op: "run", command, cwd }` |
| `browser_get_state` | `{ op: "browser" }` |
| `browser_open_url` | `{ op: "openUrl", url }` |
| `computer_get_appearance` | `{ op: "appearance" }` |
| `computer_set_wallpaper` | `{ op: "setWallpaper", wallpaper }` |
| `computer_set_theme` | `{ op: "setTheme", theme }` |

`select_computer` → `POST /api/workspace/select` then remount. `x-actor: agent`.

Human card click → same select route, `x-actor: human`.

Read-only tools: `readOnlyHint: true`.

## Policy (implemented in contract)

`requiresApproval` / `isDetachedCommand` — do not reimplement.

Detached `run` returns `{ exitCode: null, running: true, pid, stdout }` after matching `/Local:\\s|listening|ready/i` on stdout or 8s, whichever first. Process stays alive.

## File ownership

| Path | Owner |
|------|-------|
| `packages/contract/**` `plans/**` | frozen; phases do not edit |
| `apps/web/**` | workspace phase |
| `apps/api/**` | control-plane phase |
| `apps/bridge/**` | machine phase |
| `infra/kasm/**` | desktops phase |
| integrate may edit compose, Vite proxy, and Docker COPY of the bridge | integrate phase |

## Desktop image (locked)

- Base: `kasmweb/core-ubuntu-jammy:1.16.1` (if pull fails, same name at `1.17.0`, still jammy).
- User `kasm_user` / password `password` unless the image README says otherwise. Write the real pair in `infra/kasm/README.md`.
- `--shm-size=512m`
- Chromium flags: `--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --no-sandbox --disable-dev-shm-usage --user-data-dir=/home/kasm-user/.config/chromium`
- Replace the image’s existing browser autostart. Do not add a second Chromium.
- Wallpapers: `void` `carbon` `dark-grid` `arrows` at `/usr/share/backgrounds/webmcp/<id>.png`
- Nova default wallpaper `carbon`. Forge `dark-grid`.
- Seed `/home/kasm-user/project` with Vite, `"dev": "vite --host 127.0.0.1 --port 5173"`, deps installed in the image.
- COPY `apps/bridge` in integrate. Desktops phase may ship `infra/kasm/bridge-stub` that answers `GET /health` and `POST /act` `{op:"snapshot"}` only.

## Out of scope

`browser_create_tab`, `browser_close_tab`, `computer_set_name`, application-context tools, object-context tools, mouse fallback, iframe `allow="tools"`.
