# Send agents

Kernel is already in the repo (`packages/contract`, pnpm workspace, ARCHITECTURE). Do not send a kernel prompt.

Send these four at once. Copy from **You are a coding agent**.

| File | Owns |
|------|------|
| `phase-01-workspace.md` | `apps/web` |
| `phase-02-control-plane.md` | `apps/api` |
| `phase-03-machine.md` | `apps/bridge` |
| `phase-04-desktops.md` | `infra/kasm` |

When all four report done, send `phase-05-integrate.md` to one agent.

Read-only: `plans/**`, `packages/contract/**`.
