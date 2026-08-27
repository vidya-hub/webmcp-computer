# Architecture

A WebMCP page and a human share two live Linux computers. The agent does not click pixels. Tools follow the computer the human has selected.

```
Chrome (WebMCP + Axiom workspace)
        │  one origin, :5173
        │  /api/*  /desktops/nova  /desktops/forge
        ▼
Control plane :8787
        │  selected computer is an invariant, not a parameter
        ▼
Machine          Machine
nova bridge      forge bridge
        │                │
        ▼                ▼
   XFCE + Chromium   XFCE + Chromium
   CDP :9222         CDP :9222
```

ChatGPT talks to the page. The page talks to the control plane. The control plane talks to a `Machine`. KasmVNC is a picture of that same machine.

## Modules

Four modules. Callers learn these interfaces. Everything else is implementation.

### 1. Workspace (`apps/web`)

The page the human and ChatGPT share.

**Interface:** thirteen WebMCP tools (see CONTRACT) plus the visible Axiom chrome (two desktops, selection, activity, approval).

**Invariants:**

- Tools register on this origin only. Iframes do not get `allow="tools"`.
- Machine tools do not take `computerId`. They call `POST /api/act`.
- `select_computer` is the only tool that names a machine. It changes control-plane selection, the Ember left border, and which machine tools are mounted.
- The page never talks to a bridge or to CDP.
- Fetch only same-origin `/api`. No `localhost:8787` in the browser.

**Implementation hides:** Vite, React store, `usewebmcp`, polyfill, iframe srcs, WS subscription.

### 2. Control plane (`apps/api`)

Workspace state for the pair of computers.

**Interface** (`ControlPlane` in `packages/contract`):

```
listComputers()
workspace()
select(id, actor)
act(op, actor)          // selected machine; may wait on approval
resolveApproval(id, decision)
```

HTTP adapter is small on purpose: `/api/computers`, `/api/workspace`, `POST /api/act`, approve/reject, `/api/ws`, plus `/desktops/*` reverse proxy.

**Invariants:**

- One selected computer. Starts as `nova`.
- `act` uses that computer. None selected → 409.
- `act` appends activity, gates dangerous commands, auto-detaches `npm run dev`.
- Dangerous `act` keeps the HTTP request open until Approve, Reject, or 120s. WS pushes the pending approval so the dialog can fire.
- `x-actor: human | agent | system`. Default `agent`.

**Internal seam — `Machine`:** two adapters, so the seam is real.

| Adapter | When |
|---------|------|
| `MemoryMachine` | tests, and when `NOVA_BRIDGE` / `FORGE_BRIDGE` are unset |
| `HttpMachine` | `POST {bridge}/act` |

Workspace tests and API tests both use `MemoryMachine`. They do not boot Kasm.

### 3. Machine (`apps/bridge`)

One live computer. No id in the interface; the process is the computer (`MACHINE_ID` is env for snapshots only).

**Interface** (`Machine` in `packages/contract`): snapshot, files, run, appearance, browser. One HTTP route: `POST /act`.

**Invariants:**

- Paths resolve under `/home/kasm-user` (or `HOME_JAIL` on a laptop).
- `run` either waits ≤30s for exit, or detaches. Detach is not optional for `npm run dev` / `npm start` / `pnpm dev` / `yarn dev`. Detached result: `{ exitCode: null, running: true, pid, stdout }` after the ready line or 8s.
- Appearance reads XFCE. Json is not the source of truth. If `/.dockerenv` exists and `xfconf-query` does not apply, `setWallpaper` / `setTheme` throw. Laptop may set `ALLOW_JSON_APPEARANCE=1`.
- `openUrl` uses CDP on `127.0.0.1:9222` of the Chromium already on the desktop. It never spawns a browser.
- Approval is not this module's job. If `run` is called, it runs.

**Implementation hides:** jail realpath, xfconf monitor names, DISPLAY, `xdotool`, CDP websocket, detached process groups.

### 4. Desktop (`infra/kasm`)

The environment a `Machine` adapter assumes. Not a TypeScript module.

Two containers, same image, env `MACHINE_ID=nova|forge`. Visible Chromium with CDP on localhost. Wallpapers under `/usr/share/backgrounds/webmcp`. Seed project at `/home/kasm-user/project`. Bridge copied into the image at integrate time (no Mac `node_modules` volume).

## Seams

```
WebMCP tool  ──►  ControlPlane.act / select     (in-page fetch /api)
ControlPlane ──►  Machine                        (MemoryMachine | HttpMachine)
Machine      ──►  Linux / XFCE / CDP             (only inside the container)
Browser      ──►  /desktops/:id                  (same origin, control plane proxies VNC)
```

Do not add a seam for “UI store vs API.” Selection lives on the control plane. The page subscribes.

Do not add a seam for “appearance json vs xfconf.” XFCE is the computer.

## What v1 got wrong

- Five “parallel” file trees with a markdown contract. Types matched. Runtime did not.
- Workspace UI and WebMCP split across two owners of `apps/web`. One module.
- REST proxy of every bridge route. Shallow. `POST /api/act` is the machine surface.
- `VITE_API_URL=http://localhost:8787`. Breaks any origin that is not that host. Same-origin `/api`.
- `npm run dev` as a 30s blocking shell. Detach.
- Appearance json that can 200 while XFCE does nothing.
- 1200px Axiom marketing width around two 1920 desktops.
- Volume-mounting host TypeScript into Linux.

## One origin

Judge Chrome opens `http://127.0.0.1:5173`.

| Path | Goes to |
|------|---------|
| `/` | Workspace |
| `/api/*` | Control plane (Vite proxy, `ws: true`) |
| `/desktops/nova/*` | Control plane → Kasm 6901 |
| `/desktops/forge/*` | Control plane → Kasm 6902 |

Bridges bind container `:8080`. Compose publishes `127.0.0.1:8081-8082` for the API on the host, not for the browser.

Guest Vite (`npm run dev` on Nova) is `http://127.0.0.1:5173` **inside the container**. That is a different 5173. `browser_open_url` uses the guest URL.

## Demo path the architecture must survive

1. Human: set up Nova, dark, grid wallpaper, inspect project, run it.
2. Agent: `list_computers` → `select_computer nova` → `set_theme dark` → `set_wallpaper dark-grid` → `list_files` → `read_file package.json` → `run npm run dev` (detach) → `openUrl http://127.0.0.1:5173`.
3. Human sees XFCE and Chromium change on the Nova iframe.
4. Human: check Forge too.
5. Agent: `select_computer forge`. Nova machine tools unmount. Ember border moves. Repeat against Forge.

## Build order

Kernel is already this directory: `packages/contract`, workspace files, this document.

| Track | After kernel | Blocked on |
|-------|----------------|------------|
| Workspace | yes | integrate for VNC-in-iframe |
| Control plane | yes | — |
| Machine | yes | — |
| Desktops | yes | — |
| Integrate | no | all four |

Integrate is a real pass: iframe framing, xfconf on the real DISPLAY, CDP is the window you see, detach, approval dialog unblocks `act`.
