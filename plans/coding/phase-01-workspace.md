# CODING AGENT PROMPT — copy everything below this line

You are a coding agent. Implement ONLY the workspace module of WebMCP Computer.

Project root: `/Users/vidyasagar/ProjectSpace/webmcp_exp/webmcp-computer`

Read `plans/ARCHITECTURE.md`, `plans/CONTRACT.md`, `plans/DESIGN.md`. Do not edit them or `packages/contract`.

## Hard rules

- TypeScript. Avoid `any`.
- Own `apps/web/**` only.
- Depend on `@webmcp-computer/contract` and on `usewebmcp` + `@mcp-b/webmcp-polyfill` (see `../webmcp-board`).
- Fetch same-origin `/api/...` only. No `VITE_API_URL` pointing at `:8787`.
- Iframe `src` is `/desktops/nova/` and `/desktops/forge/`.
- If root `pnpm-workspace.yaml` exists, leave it.
- No Docker. No bridge. No Hono server in this package.
- When finished: list files changed and how to verify this phase only.

Locked: React 19, Vite port 5173, JetBrains Mono, Hono is not yours.

Vite `server.proxy`:

```
/api → http://127.0.0.1:8787 (ws: true)
/desktops → http://127.0.0.1:8787 (ws: true)
```

Call `initializeWebMCPPolyfill()` in `main.tsx` before render.

## Goal

Axiom full-bleed workspace (DESIGN.md). Package `@webmcp-computer/web`.

**Store:** selection, activity, pendingApproval, computers all come from `GET /api/workspace` + `GET /api/computers` + `WS /api/ws`. If `/api/health` fails, show `api offline` in the status line and keep empty lists. Do not seed fake nova/forge in the client.

**Human select:** `POST /api/workspace/select` with `x-actor: human`.

**Approval:** when `pendingApproval` is set, DESIGN dialog. Approve/Reject `POST /api/approvals/:id/approve|reject`.

**WebMCP** in `src/webmcp/`:

- Always: `list_computers`, `get_workspace_state`, `select_computer` (`x-actor: agent`).
- When `workspace.selectedComputer` is set, mount the ten machine tools. Each `execute` is `POST /api/act` with the `MachineOp` from CONTRACT. Unmount on selection change.
- Machine tools take no `computerId`.
- `computer_list_files` default path `/home/kasm-user`.
- Read-only tools get `readOnlyHint: true`.
- `computer_run_command` waits for the POST to finish (server blocks on approval). Do not poll.

DEV: list registered tool names if `getTools` exists.

`pnpm --filter @webmcp-computer/web dev`

## Done when

- Vite loads a void full-bleed shell, two iframe slots, activity column.
- With API down: `api offline`, no invented machines.
- With API up (control plane running): click Forge, Ember left border moves, status `selected=forge`.
- Polyfill or Chrome flag: three workspace tools always; ten more after select.
