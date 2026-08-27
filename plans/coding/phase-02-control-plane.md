# CODING AGENT PROMPT — copy everything below this line

You are a coding agent. Implement ONLY the control plane of WebMCP Computer.

Project root: `/Users/vidyasagar/ProjectSpace/webmcp_exp/webmcp-computer`

Read `plans/ARCHITECTURE.md` and `plans/CONTRACT.md`. Do not edit them or `packages/contract`.

## Hard rules

- TypeScript. Avoid `any`.
- Own `apps/api/**` only.
- `@webmcp-computer/contract` for types, `dispatch`, `requiresApproval`, `isDetachedCommand`.
- Hono. Port 8787. CORS origin `http://127.0.0.1:5173` and `http://localhost:5173`.
- No React. No Docker image. No xfconf/CDP here.
- When finished: list files changed and how to verify this phase only.

## Goal

Package `@webmcp-computer/api`. Implement `ControlPlane`. HTTP as CONTRACT.

**Machines map:**

- If `NOVA_BRIDGE` / `FORGE_BRIDGE` set, `HttpMachine` (`POST ${url}/act`).
- Else `MemoryMachine` per id: in-memory fs rooted at a map, appearance `{ theme: "dark", wallpaper: carbon|dark-grid }`, `run` implements `ls`/`echo`/`mkdir` enough for tests, `openUrl` mutates a fake tab list. `snapshot.browserStatus` `"stopped"` unless a url was opened.

**select** updates state, activity (`selected nova`), WS `selection`.

**act:**

1. 409 if no selection.
2. If `op === "run"` and `requiresApproval(command)`: create pending approval, WS `approval`, wait until `resolveApproval` or 120s. Reject/timeout as CONTRACT. Do not call `Machine.run` until approved.
3. Else `dispatch(machine, op)`. If `op === "run"` and `isDetachedCommand`, the Machine (or HttpMachine) is responsible for detach; do not wrap a second time.
4. Mutating ops append activity (`x-actor` or agent).
5. HttpMachine errors → 502.

At most one pending approval. A second dangerous `act` → 409 `{ error: "approval already pending" }`.

**Desktop proxy:** `/desktops/nova` and `/desktops/forge` reverse-proxy to `NOVA_VNC` default `http://127.0.0.1:6901` and `FORGE_VNC` default `http://127.0.0.1:6902`, websocket included. If upstream is down, 502 text `desktop offline`.

`computersRunning` counts machines whose `snapshot()` or bridge `/health` succeeds.

`pnpm --filter @webmcp-computer/api dev` (tsx watch).

## Done when

```
curl -s localhost:8787/health
curl -s localhost:8787/api/computers
curl -s -X POST localhost:8787/api/workspace/select -H 'content-type: application/json' -d '{"computerId":"forge"}'
curl -s -X POST localhost:8787/api/act -H 'content-type: application/json' -d '{"op":"snapshot"}'
```

With bridges unset, snapshot returns MemoryMachine state for forge after select.

```
curl -s -X POST localhost:8787/api/act -H 'content-type: application/json' -d '{"op":"run","command":"rm -rf /tmp/x"}'
```

blocks until `POST /api/approvals/<id>/reject` from another terminal, then JSON `reason` is the reject string.
