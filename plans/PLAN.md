# WebMCP Computer — build plan

Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Types: `packages/contract`. HTTP/tools: [CONTRACT.md](CONTRACT.md). Axiom: [DESIGN.md](DESIGN.md).

Kernel is already in the repo. Do not send a kernel agent.

```
              packages/contract
                     │
     ┌───────────────┼───────────────┬──────────────┐
     ▼               ▼               ▼              ▼
 workspace     control plane      machine       desktops
 apps/web        apps/api       apps/bridge    infra/kasm
     │               │               │              │
     └───────────────┴───────┬───────┴──────────────┘
                             ▼
                         integrate
```

Workspace, control plane, machine, desktops can start together. They share the contract package, not each other’s source. Integrate is blocked on all four.

## Tracks

| Send | Owns | Done when (alone) |
|------|------|-------------------|
| `phase-01-workspace.md` | `apps/web` | Axiom chrome, thirteen tools, `/api` fetch, iframe slots at `/desktops/*`. API down → `api offline`, no fake computers. |
| `phase-02-control-plane.md` | `apps/api` | MemoryMachine + HttpMachine, `POST /api/act`, approval wait, WS, `/desktops` proxy. |
| `phase-03-machine.md` | `apps/bridge` | Linux `POST /act`, jail, detach, xfconf-or-throw in Docker, CDP navigate. Laptop jail works. |
| `phase-04-desktops.md` | `infra/kasm` | Two VNC, one visible Chromium with CDP, seed project, wallpapers. Stub bridge OK. |
| `phase-05-integrate.md` | glue | Demo path in ARCHITECTURE. After 01–04. |

## Demo

Human: set up Nova. Dark, grid wallpaper, inspect the project, run it.

Agent: `select_computer nova` → theme/wallpaper → files → `npm run dev` (detach) → `browser_open_url http://127.0.0.1:5173`.

Human: check Forge too. Agent selects Forge. Tools abort and remount. Ember border moves.

## Locked

- Two machines: nova, forge.
- Thirteen tools. `POST /api/act` is the machine surface.
- Tools follow selection. No `computerId` on machine tools.
- Same origin. Website Axiom dark, full bleed. XFCE may go light.
- Wallpapers: `void | carbon | dark-grid | arrows`.
- Hono. No Express fork.
- Chrome with WebMCP flag or polyfill. Judge opens `http://127.0.0.1:5173` on the machine that runs Docker.

## Send

[coding/START.md](coding/START.md)
