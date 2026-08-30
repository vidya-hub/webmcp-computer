# Handoff — assume Claude’s working tree

This UI plan is written against **in-flight hardening**, not last week’s `main`. Treat the table as landed unless `git grep` says otherwise.

## Consume, do not revert

| Incoming | What you do |
|----------|-------------|
| `store.tape` + WS `prependTape`; ActionTimeline already dropped the 2.5s poll | Keep `merge(historyFetchOnOpen, store.tape)`. Rewrite the **view** only. |
| MenuBar `apiOnline` → “reconnecting” | One Offline pill. Do not add a second indicator. |
| `register.tsx` always mounts `MachineTools` | Empty state: tools are **already live**. |
| `wm.arrange()` + `workspace_arrange_windows` | Interpolate bounds for arrange, maximize, snap. Disable transition only while `.dragging` / `.resizing`. |
| `RecipeStep` / `RecordedAction`; `GET/POST /api/actions`, `/promote`, `/:id/replay`, `DELETE` | Recipes **tab** in the inspector. No new backend. No second overlay. |
| `destroy_computer` mentions save-files; `Approval.options` + `/choose` | Style the sheet. Do not add `{ saveFiles }` on `/approve`. |
| `home_archives` table; **no `/api/archives` yet** | Hide Restore if GET 404s or is empty. |
| `SHOT_SKIP_OPS` + optimistic tape | Most events have no shots. Two placeholder tiles. |
| `prependTape` skips same `id` | **Bug for live shots.** Replace-by-id so `before`/`after` can update. |
| No `durationMs` on `TapeEvent` | Min bar width (~8px). If Claude adds `durationMs`, use it. Do not edit `plane.ts`. |
| Red traffic light = `destroyComputer` | Close does not FLIP to the dock. Yellow = hide. |
| Full-page `BootSequence` | **Delete.** First paint is the desktop. Keep and finish the **per-window** `.wm-boot` for the whole `starting` period. |

## APIs the UI may call

```
GET    /api/tape
GET    /api/tape/:id/before
GET    /api/tape/:id/after
GET    /api/actions
GET    /api/actions/:id
POST   /api/actions              { name, description?, steps? }
POST   /api/actions/promote      { count?, name, description? }
POST   /api/actions/:id/replay   { speed? }     timeout 130s, x-actor: human
DELETE /api/actions/:id
POST   /api/computers            { name?, role?, restoreArchiveId? }   restore only if supported
GET    /api/archives             optional — 404 is fine
```

Promote default `count` is 10. After a successful promote, switch to the Recipes tab and select the new id.

## File conflict map

| Path | Owner |
|------|--------|
| `ActionTimeline.tsx`, `Shell.tsx`, `axiom.css`, `Dock.tsx`, `Window.tsx`, `sound.ts` | **This track** after start |
| `MenuBar.tsx`, `wm.ts`, `server.ts` | Rebase |
| `MachineTools.tsx` | Typing scheduler only |
| `plane.ts`, `WorkspaceTools.tsx`, contract policy, deploy | Claude |

## `durationMs` ask (Claude, not this folder)

Optional `TapeEvent.durationMs` from `Date.now() - t0` around `dispatch`, plus `duration_ms int` in boot-DDL. The waterfall reads it when present.

## REQUIREMENTS

Do not both edit `plans/REQUIREMENTS.md` §6–7 in the same hour. This track appends a **Host chrome** note under §7 after Claude’s tool-list pass: docked inspector, side-by-side shots, always-registered tools, glass desktop (live CSS, not Axiom-on-paper).
