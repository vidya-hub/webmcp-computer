# Frontend state management refactor (Zustand)

## Context

`apps/web` state is a single React Context (`state/workspace-store.tsx`, 7 `useState` in one
provider) plus large pockets of local component state. The result:

- **One context value → whole-tree re-renders.** Every consumer (Shell, Canvas, all N
  Windows, Dock, MenuBar, Toasts, ActionTimeline) re-renders on any change, including the
  8-second poll tick.
- **Refetch-everything sync.** The `/api/ws` handler ignores the server's typed WS payloads
  (`{type:"activity"|"tape"|...}`) and just calls `refresh()` (two API calls); an 8s poll
  runs on top. No incremental updates.
- **Window-manager state scattered.** `Canvas.tsx` holds bounds/z/drag/maximize/snap/overview
  + three animation `Set`s across 9 `useState` / 6 `useRef` / 7 effects, mirrors derived
  state from `computers` via effects, and drives animations with ad-hoc `setTimeout`s — while
  `minimized` lives in the store. Two sources of truth for one concern.
- **Server state vs UI state conflated.** API data (computers/workspace/activity) sits in the
  same blob as pure client state (window bounds, overview, boot, sound, idle).
- **WebMCP tools churn / stale closures.** `WorkspaceTools`/`MachineTools` read `useWorkspace()`,
  so they re-render as context changes and capture values in closures; the store can't be read
  outside React (e.g. from the WS handler).

Goal: introduce a proper store, separate server/UI/WM concerns, use selector subscriptions to
kill broad re-renders, apply WS events incrementally, and move scattered WM/derived state into
tested store logic — **without** over-correcting (truly local presentational state stays local).

## Decision: Zustand (not Redux Toolkit)

Zustand fits this app better: minimal boilerplate, **selector subscriptions** solve the
re-render problem directly, and `store.getState()` / `store.subscribe()` work **outside React**
— exactly what the WS sync service and WebMCP tool handlers need (no stale closures, no
re-registration). RTK's reducers/thunks add ceremony for little gain here, since server sync is
imperative (WS push + fetch), not cache-query shaped. (React Query is noted as an optional
alternative for server state in §Alternatives, but not recommended — the push model doesn't map
cleanly to query caching.)

## Target architecture

```
main.tsx  → create store, start sync service (once)
store/
  index.ts        create()+slices; export useStore, typed hooks, raw `store`
  slices/
    server.ts     apiOnline, computers, selectedComputer, pendingApproval,
                  activity, computersRunning, acting{ComputerId,Verb}; actions:
                  select/spawn/destroy/resolveApproval/resolveChoice/beginAct/endAct
    wm.ts         windows:Record<id,Bounds>, draggingId, maximizedId, snap,
                  overview, minimized, zTop, lifecycle:Record<id,Phase>; actions:
                  reconcile(computers), focus, move, resize, patchBounds, maximize,
                  snap, minimize, restore, close, toggleOverview
    ui.ts         booted, justBooted, idle, timelineOpen, sound, bootNonce (persist
                  sound + booted via zustand/middleware persist, partialized)
  selectors.ts    reusable selectors (useShallow for arrays/objects)
  sync.ts         owns refresh() + /api/ws; applies typed WS events incrementally;
                  writes via store.setState; 30s fallback poll (down from 8s)
```

- **Components subscribe narrowly:** `useStore(s => s.computers)`, `useStore(useShallow(...))`.
  A window subscribes only to its own bounds/flags → moving one window stops re-rendering all.
- **WM logic becomes pure store actions** (relocated from Canvas): reconcile replaces the
  bounds-mirroring effect; lifecycle phases are set by actions and cleared on CSS
  `animationend` (or a single tick helper) instead of scattered timers.
- **WebMCP tools read `store.getState()`** in handlers; registration no longer depends on
  changing store values → stable, no re-registration. `beginAct/endAct` become store actions.
- **`webmcpReady`** becomes a reactive store value (set on polyfill init / short probe), not a
  one-time computed const.

## What stays local (avoid over-correction)

Purely presentational, component-scoped state stays in `useState` — do **not** push into the
store: MenuBar clock `now`, Dock magnify `scales`, BootSequence internal lines, Window
`closeArmed`/`boot` animation, ActionTimeline's selected-event/lightbox UI. Rule: server,
shared, or cross-cutting state → store; ephemeral view-only state → local.

## Migration (incremental; app stays working at every step)

1. **Add `zustand`**; scaffold `store/` slices + `sync.ts`. Keep `useWorkspace()` as a thin
   shim that reads the store, so existing components compile unchanged.
2. **Move sync out of the provider** into `sync.ts`; apply WS payloads incrementally (activity
   prepend, approval set/clear, computers upsert/remove); relax poll to 30s fallback. Start it
   from `main.tsx`. Replace `WorkspaceProvider` with store init in `App.tsx`.
3. **Migrate WM state** from `Canvas.tsx`/`Window.tsx` into `wm.ts`; Canvas/Window become thin
   (subscribe + dispatch). Delete the derived-state effects and timer soup. Add unit tests for
   the pure wm reducers (reconcile/focus/maximize/snap/minimize).
4. **Migrate cross-cutting UI state** (Shell booted/idle/timelineOpen, sound) to `ui.ts`; leave
   the local-only bits local (see above).
5. **Point WebMCP tools at `store.getState()`**; drop context deps in `WorkspaceTools`/
   `MachineTools`/`register.tsx`. Remove the `useWorkspace` shim and old provider.
6. **Cleanup:** delete dead legacy files if unused (`ui/Desktops.tsx`, `ui/MachineList.tsx` —
   the nova/forge remnants); remove stale effects; final typecheck + build.

## Critical files

- New: `apps/web/src/store/index.ts`, `store/slices/{server,wm,ui}.ts`, `store/sync.ts`,
  `store/selectors.ts`.
- Modify: `apps/web/src/main.tsx`, `App.tsx`, `ui/wm/Canvas.tsx`, `ui/wm/Window.tsx`,
  `ui/Shell.tsx`, `ui/MenuBar.tsx`, `ui/Dock.tsx`, `ui/Toasts.tsx`, `ui/ActionTimeline.tsx`,
  `webmcp/{WorkspaceTools,MachineTools,register}.tsx`.
- Remove after shim retire: `state/workspace-store.tsx` (+ dead `ui/Desktops.tsx`,
  `ui/MachineList.tsx` if confirmed unused).
- Reuse existing: `api/client.ts` (`api`, `toolResult`) unchanged; contract types
  (`WorkspaceState`, `ActivityEvent`, `Approval`, `Computer`) unchanged; server WS event
  shapes in `packages/contract` (`{type:"activity"|"tape"|...}`) drive `sync.ts`.

## Verification

- `pnpm --filter @webmcp-computer/web build` (tsc + vite) clean.
- Run app: spawn / select / act / approval (Enter-to-approve, Esc) / destroy still work; WM
  drag/resize/maximize/snap/overview/minimize/close + animations unchanged.
- React DevTools Profiler: moving one window or an activity tick no longer re-renders unrelated
  components (the core win).
- WS incremental: an agent action updates activity/approval without a full refetch; kill the
  poll temporarily to confirm WS alone keeps state fresh.
- `wm.ts` reducer unit tests pass.
- Smoke on the deployed tailnet URL after redeploy.

## Alternatives (considered, not chosen)

- **Redux Toolkit** — heavier boilerplate; async here is push-based, not query-cache shaped.
- **React Query for server state + Zustand for UI** — viable, but adds a dep and the WS-push
  model fights query caching; revisit only if server state grows (pagination, many resources).
