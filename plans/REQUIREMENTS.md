# Requirements

This file is the product. Older plans that still say Nova/Forge, two seeded machines, or hardcoded `/desktops/nova` are stale. Do not implement from them.

> **Amendments (current implementation).** The sections below predate several shipped changes; where they conflict, this block wins:
> - **Image/desktop:** the guest is `infra/slim` → `webmcp-slim:local` running **Openbox/tint2** (not XFCE); the `webmcp-kasm` path is legacy. Descriptions that say "XFCE" mean the current WM.
> - **Tools:** the tool set is the `WEBMCP_TOOLS` array in `packages/contract/src/index.ts` (~50 tools), not the historical 13. Machine tools are **always registered**; when no computer is selected they return a "select a computer first" result (they do NOT unmount on selection — ignore any §-level line saying tools mount/unmount on select). `computer_take_screenshot` and `browser_screenshot` return an **image content block**, not base64 text.
> - **Teach & Replay (record real desktop use):** press **Record** on a computer's window titlebar and everything happening in that desktop during the window is captured — **human mouse/keyboard (recorded in the noVNC viewer as framebuffer-coordinate input steps) and any agent `MachineOp`s**, merged in time order by one API clock — then named/saved and replayed **literally** on the selected computer via a single `replayAction` op. Also: promote-from-tape and authored recipes. Replay is **human-free / agent-gated**: a human clicking Replay runs immediately (even recorded `rm`); an agent's `replay_recorded_action` takes **one** approval that lists gated ops and a preview of typed text. Selecting another window does not discard the recording (destroy of that computer, API shutdown, and the time/step cap do). Tools: `list/get/save/replay/delete_recorded_action`, `list_file_archives`, `delete_file_archive`. Recording itself is human-only (no agent record tool); capture is viewer-first, so no in-guest `xinput`/image rebuild.
> - **Home persistence (exception to the “ephemeral / no volumes” rule below):** on destroy the human may choose "Destroy and save files" to archive the guest home (user work only — the browser profile/caches are excluded) to MinIO; a future `spawn_computer {restoreArchiveId}` restores it. Tool: `list_file_archives`.
> - **Approval policy:** `requiresApproval` escalates any command containing a shell metacharacter (`; & | \` $ < > ( ) { }`) in addition to the deny-list; `node`/`npm`/`python` remain allow-listed (the gate is not a sandbox).
> - **Ops:** `HOST_BACKEND=docker` fails fast instead of falling back to a fake host; the tape is best-effort (never blocks or fails an action); desktops run without `SYS_ADMIN`; the bridge requires a per-spawn `MACHINE_TOKEN`; access is tailnet-only with `ALLOWED_ORIGINS` Origin checks.

Human and agent share live Linux desktops in one browser origin. The agent uses WebMCP on the **parent page**. The human sees those desktops as **windows** on that page. The computer tells the agent what it can do on the **selected** machine. No screenshot clicking. No `mouse_click`.

```
Chrome  http://127.0.0.1:5173
  WebMCP tools (workspace + selected machine)
  window manager (one window per computer)
  activity rail
        │  /api/*  /desktops/:id/*
        ▼
Control plane :8787
        │  selected id is an invariant of act()
        ▼
Computer host
  spawn / destroy / list / bridge(id) / vnc(id)
        ▼
each live computer: XFCE + Chromium (CDP :9222) + machine bridge :8080
```

---

## 1. Identity (non-negotiable)

There are **no product computer names**. Not Nova. Not Forge. Not Anvil. Not a TypeScript union of heroes.

A computer is a record created at runtime:

| Field | Rule |
|-------|------|
| `id` | `string`. Slug. Unique. The only handle. |
| `name` | Display string. From the spawn param or generated. |
| `role` | Optional label (`developer` / `testing` / whatever was passed). Not a switch the UI or compose files key off. |
| `status` | `starting` \| `running` \| `error` \| `stopped` |

`ComputerId` in code is `string`. Delete `SEED_COMPUTERS`. Delete `"nova" \| "forge"`.

**Spawn name**

```
spawn_computer({ name?: string, role?: string })
```

- If `name` is a non-empty string: slugify (lowercase, `[a-z0-9]+` joined by `-`). `Anvil Box` → `anvil-box`. `id` starts as that slug.
- If `name` is omitted: generate `id` as `{adjective}-{noun}-{3 hex}` from a local word list (example shape: `quiet-ridge-a3c`). That string is both `id` and default `name`.
- Collision: append `-2`, `-3`, …
- Reject empty / punctuation-only names with 400.

No default id in env files, compose service names, or `select_computer` enums.

**Wallpaper** is not derived from the name. On spawn, assign the next of `carbon`, `dark-grid`, `void`, `arrows`. Pass `WALLPAPER` into the container. `custom_startup.sh` reads that env. No `if id == …`.

---

## 2. How many computers

**Boot: zero or more.** Control plane starts, reconciles labeled containers, selects the first if any exist. It does **not** spawn when the list is empty.

**Cap: 4** live computers. A fifth `spawn_computer` returns 409.

**Destroy** is confirmation-gated. After the last destroy the workspace is empty: centered **New Computer**, no dock. Spawn from empty selects the new machine.

Compose **does not** define named machines. `infra/kasm` builds an image. The API is the only lifecycle (`docker run` / `docker rm -f`).

---

## 3. Story

Wrong: “select Nova, then check Forge.”

Right:

1. Page loads. One window. Generated id, e.g. `quiet-ridge-a3c`.
2. Human: make it dark, grid wallpaper, inspect the project, run it.
3. Agent: `list_computers` → `select_computer` with **that id** → theme / wallpaper / files / `npm run dev` (detach) → `browser_open_url http://127.0.0.1:5173` (guest).
4. Human: give me another machine called `ci`.
5. Agent: `spawn_computer({ name: "ci" })` → window `ci` appears → `select_computer` `ci` → tools remount. Ember border moves.
6. Optional: `destroy_computer` → approval dialog → window gone.

The agent must use ids from `list_computers` / spawn return values. It must not assume any literal name.

---

## 4. Modules

### Workspace (`apps/web`)

The page. One origin.

- Registers WebMCP. Iframes never get `allow="tools"`.
- Machine tools do not take `computerId`. They `POST /api/act`.
- `select_computer` is the tool that names a machine.
- Fetch only `/api…`. Never `localhost:8787` in the browser.
- Renders **one window per** `GET /api/computers` on a void canvas. Drag, resize, overlap, z-stack.
- Activity rail (right, 280px). No left machine list (titlebar is the name).

### Control plane (`apps/api`)

```
listComputers()
workspace()
select(id, actor)
spawn({ name?, role? }, actor)
destroy(id, actor)          // waits on approval
act(op, actor)              // selected machine
resolveApproval(id, decision)
```

- `act` uses the selected id. None selected → 409. Unknown id on select → 404.
- Dangerous `run` and `destroy` keep the HTTP request open until Approve / Reject / 120s.
- `x-actor`: `human` | `agent` | `system`. Default `agent`.
- Mutating ops append activity. Reads do not.

**Internal seam — Computer host**

```
spawn(spec) → Computer
destroy(id)
list()
bridge(id) → Machine
vnc(id) → https url + port
```

| Adapter | When |
|---------|------|
| `DockerHost` | `docker` on PATH; image `webmcp-kasm:local` exists |
| `MemoryHost` | tests; laptop with no Docker |

One adapter per process. Never both (that duplicates the list again).

`Machine` adapters behind the host: `HttpMachine` (`POST {bridge}/act`) and `MemoryMachine` (in-process fs).

### Machine (`apps/bridge`)

The process **is** the computer. `MACHINE_ID` / `MACHINE_NAME` / `WALLPAPER` from env. `POST /act`, `GET /health`.

- File jail: realpath under `$HOME` / `HOME_JAIL` (computer id user on slim). 400 `{ error: "path outside jail" }`. Read cap 256KB.
- `run`: wait ≤30s, or **detach** if `isDetachedCommand` (`npm run dev` / `start` / pnpm / yarn). Detach: `{ exitCode: null, running: true, pid, stdout }` after `/Local:\s|listening|ready/i` or 8s.
- Appearance: Openbox slim uses `xsetroot` + `$JAIL/.webmcp-appearance.json`. XFCE/`xfconf` only if that binary exists. Laptop `ALLOW_JSON_APPEARANCE=1` may use json.
- Browser: CDP `127.0.0.1:9222` on the **visible** Chromium. CDP down: `browser()` empty 200. `openUrl` starts Chromium once if CDP is down, then navigates. No restart loop. Tab tools, visible text, find text, and CSS-selector click are allowed. Guest `xdotool` mouse/keyboard is allowed. No `find_pixel`. No host-page click.

### Desktop image (`infra/slim`)

One image: `webmcp-slim:local`. Debian bookworm-slim, Openbox, Chromium, TigerVNC, noVNC.

- Guest Linux user = `MACHINE_ID` (override `LINUX_USER`). Home `/home/<id>`.
- Chromium flags in `/etc/chromium.d/webmcp`. `openUrl` starts Chromium once if CDP is down. No restart loop.
- Wallpaper: `xsetroot` solid from `WALLPAPER`.
- Bridge is prebuilt `node /opt/webmcp/bridge/dist/index.js`.
- `shm_size=512m`, `--memory=2g --cpus=1.5 --pids-limit=512`. VNC HTTP on `6901`, no TLS.

`DockerHost` run:

```
docker run -d --name webmcp-$id \
  --label webmcp.computer=1 \
  --shm-size=512m \
  -p 127.0.0.1:0:6901 \
  -p 127.0.0.1:0:8080 \
  -e MACHINE_ID=$id -e MACHINE_NAME=$name -e WALLPAPER=$wallpaper -e VNC_PW=password \
  webmcp-kasm:local
```

Dynamic host ports. API maps them. Browser never talks to those ports.

On API boot, `docker ps --filter label=webmcp.computer=1` reattaches.

---

## 5. HTTP (browser origin)

Vite `:5173` proxies `/api` and `/desktops` to `:8787` (`ws: true`).

```
GET    /health
GET    /api/health
GET    /api/computers
POST   /api/computers                 { name?, role? }
DELETE /api/computers/:id             approval
GET    /api/workspace
POST   /api/workspace/select          { computerId: string }   x-actor
POST   /api/act                       MachineOp                x-actor
POST   /api/approvals/:id/approve
POST   /api/approvals/:id/reject
GET    /api/ws
ALL    /desktops/:id/*                → that record’s VNC
```

VNC proxy: `https://127.0.0.1:${vncPort}`, `secure: false`, Basic `kasm_user:password`, strip `Cross-Origin-Embedder-Policy`, `Cross-Origin-Opener-Policy`, `X-Frame-Options`. Inject `Authorization` on HTTP and WebSocket.

`POST /api/act` has **no** computer id. Selected machine only.

Errors: 404 unknown computer, 409 none selected / cap / approval already pending, 502 bridge unreachable, 400 path outside jail.

---

## 6. WebMCP tools

Register on the parent page only.

**Always**

| Tool | Input | Notes |
|------|--------|------|
| `list_computers` | `{}` | `readOnlyHint` |
| `get_workspace_state` | `{}` | `readOnlyHint` |
| `select_computer` | `{ computerId: string }` | remounts machine tools |
| `spawn_computer` | `{ name?: string, role?: string }` | blocks until running or 60s |
| `destroy_computer` | `{ computerId: string }` | waits on human Approve/Reject |

**While a computer is selected** (unmount on change, same as `webmcp-board` selection tools)

| Tool | `MachineOp` |
|------|-------------|
| `computer_get_state` | `{ op: "snapshot" }` |
| `computer_list_files` | `{ op: "listFiles", path }` default `/home/kasm-user` |
| `computer_read_file` | `{ op: "readFile", path }` |
| `computer_write_file` | `{ op: "writeFile", path, content }` |
| `computer_run_command` | `{ op: "run", command, cwd? }` |
| `browser_get_state` | `{ op: "browser" }` |
| `browser_open_url` | `{ op: "openUrl", url }` |
| `computer_get_appearance` | `{ op: "appearance" }` |
| `computer_set_wallpaper` | `{ op: "setWallpaper", wallpaper }` |
| `computer_set_theme` | `{ op: "setTheme", theme }` |

Reads: `readOnlyHint: true`. `computer_run_command` waits on the POST (server blocks on approval). Do not poll.

Polyfill: `initializeWebMCPPolyfill()` in `main.tsx`. Native `document.modelContext` when the Chrome flag is on.

---

## 7. Window manager

The website is one screen. Computers are windows on a void canvas.

- Pointer events only. No `react-rnd`.
- Titlebar drag. 6px edges resize. Min ~320×240. Clamp to canvas.
- Click raises z. Unfocused: transparent hit layer over the iframe (VNC would steal drags).
- While drag/resize: `iframe { pointer-events: none }`.
- First computer: almost full canvas. Each spawn: cascade +40,+40.
- Session memory only (reload retiles from `computers[]`).
- `select_computer` and in-flight `act` raise that window.

**Host chrome (macOS)**

The page is a glass desktop, not a website nav. No page BIOS; first paint is the desktop. The only boot theater is the in-window overlay while a computer `status === "starting"`.

- 28px glass menu bar: **WebMCP Computer**, Timeline, Recipes, Offline pill, WebMCP extra / `! approval`.
- Canvas is CSS wallpaper (no photo asset). Inspector **pushes** the canvas (`28px 1fr auto`); the dock stays on the canvas floor.
- Floating Dock: one tile per computer, `+` spawn (disabled at cap). Selected = solid dot; minimized = hollow. Click restores + selects.
- Windows: traffic lights (red destroy, yellow minimize FLIP to the tile, green max). Titlebar Timeline opens Tape filtered to that computer.
- Inspector: Tape | Recipes. Tape is a lane waterfall with **two** shot frames (no compare slider). Esc: lightbox → inspector → approval.
- Approval: centered glass sheet. Ember **only** on Approve fill.

Guest Linux inside the iframe is unchanged.

Tokens: `plans/DESIGN.md`. This file wins on layout.

---

## 8. Policy

`requiresApproval` / `isDetachedCommand` live in `packages/contract`. Do not copy.

Allow first token: `ls cat head tail pwd whoami uname df ps echo mkdir touch cp mv git node npm npx pnpm yarn python python3 vite which env date wc grep find file stat tree`.

Deny first token (approval): `rm apt apt-get dpkg kill pkill shutdown reboot poweroff mkfs dd sudo chmod chown curl wget systemctl userdel`.

Empty command → approval. Unknown first token → approval.

`destroy_computer` always approval, regardless of command regex.

Jail is for file ops and `run` cwd, not a seccomp sandbox. `ls /etc` from a jailed cwd still lists `/etc`. Do not “fix” that without changing this file.

---

## 9. Guest vs host ports

| Host (judge Chrome) | Guest (inside a computer) |
|---------------------|---------------------------|
| Workspace `127.0.0.1:5173` | Project Vite `127.0.0.1:5173` |
| API `127.0.0.1:8787` (proxied, not fetched by the page) | Bridge `8080`, CDP `9222`, KasmVNC `6901` |

`browser_open_url({ url: "http://127.0.0.1:5173" })` means the **guest**.

---

## 10. What WebMCP must not expose (this product)

`find_pixel`, `press_coordinate`, host-page click. Screenshot is **see**, not click-on-JPEG as the only API. Guest mouse/key (`xdotool`) and CDP selector click are in.

Out of scope until this file says otherwise: application-context tool swapping, object-context file tools, iframe `allow="tools"`, warm container pools, k8s, persisting window layout, in-app LLM.

---

## 11. Delete from the current tree

When implementing, remove:

- `ComputerId = "nova" | "forge"` and `SEED_COMPUTERS`
- `Plane` 404 unless nova/forge; default selected `"nova"`
- `NOVA_BRIDGE` `FORGE_BRIDGE` `NOVA_VNC` `FORGE_VNC`
- Hardcoded `/desktops/nova` `/desktops/forge`
- compose services `nova` / `forge` and volumes `nova-home` / `forge-home`
- `Desktops.tsx` two `<Frame id="nova"|"forge">`
- `select_computer` json schema `enum: ["nova","forge"]`
- `custom_startup.sh` `if [ "$ID" = "forge" ]`
- README / ARCHITECTURE / CONTRACT / DESIGN copy that names Nova and Forge as the product

---

## 12. Acceptance

- [ ] Page load: computers from Docker only. Empty canvas + New Computer if none. No auto-spawn.
- [ ] `list_computers` returns that one record.
- [ ] Agent `select_computer` with the returned id; that window raises and is selected; machine tools mount.
- [ ] Theme, wallpaper, list/read/write files, detach `npm run dev`, `browser_open_url` on the **visible** Chromium.
- [ ] `spawn_computer({ name: "ci" })` → id `ci`, second window, cap logic holds.
- [ ] `spawn_computer({})` → generated id, third window.
- [ ] `select_computer` to the new id; previous machine tools gone.
- [ ] In-flight `act` sets window title `AGENT …` and raises it.
- [ ] `destroy_computer` shows Approve / Reject; reject returns `User rejected the operation.`
- [ ] Human click on a window chrome selects ( `x-actor: human` ) and remounts tools.
- [ ] Drag/resize works; VNC does not eat the pointer during drag.
- [ ] Reload: computers from API (reattach Docker); windows retile; names still not hardcoded.
- [ ] `GET /api/computers` never invents a second machine that Docker did not spawn.
- [ ] Mutating act writes tape before/after + input/output on the API host; Action TimeLine shows them. Reads do not.

---

## 13. Risks that stay named

- Image must already be built (`webmcp-kasm:local`). Spawn does not build.
- Dynamic ports never leak to the browser; only the API proxy uses them.
- Spawned containers: no named volumes (ephemeral) unless this file changes.
- API on the host uses `docker` CLI. If the API later runs in Docker, it needs the socket; not now.
- One host adapter per process. Memory + Docker together will duplicate the list.
- Kasm VNC is HTTPS + Basic + COEP; proxy must keep stripping those headers.

---

## 14. Act tape

Mutating `POST /api/act` writes a timeline on the **API host**, not the guest jail.

- Dir: `data/tape/` (gitignored). `TapeStore` now; object store later.
- Cap 100 events. Oldest PNGs deleted.
- Skip pure reads (`listFiles`, `visibleText`, `screenshot`, …).
- Desktop mutations: `scrot` before/after.
- Browser mutations (`openUrl`, tabs, `clickSelector`, …): CDP full-page (`captureBeyondViewport` / clip), cap 16384px.
- Event stores `input` (the op), `output` or `error`, plus before/after PNG flags.
- `GET /api/tape` lists events (newest first). `GET /api/tape/:id/before|after` serves PNG.
- Menu **Action TimeLine**: DevTools split (event list + inspector), computer filter, click shot → lightbox. No new keyboard product.
- `main.bundle.js` / `lastActiveAt` errors from ChatGPT or extensions are not this app. Vite does not emit `main.bundle.js`.
