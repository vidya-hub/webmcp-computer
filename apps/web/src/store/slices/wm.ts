import type { Computer } from "@webmcp-computer/contract";
import type {
  Bounds,
  CanvasSize,
  Phase,
  Rect,
  Snap,
  StoreGet,
  StoreSet,
} from "../types.ts";

export type WmData = {
  windows: Record<string, Bounds>;
  draggingId: string | null;
  maximizedId: string | null;
  snap: Snap;
  overview: boolean;
  minimized: string[];
  zTop: number;
  lifecycle: Record<string, Phase>;
  savedBounds: Record<string, Bounds>;
  canvas: CanvasSize;
  knownIds: string[];
};

export type WmSlice = WmData & {
  reconcile: (computers: Pick<Computer, "id">[]) => string[];
  focus: (id: string) => void;
  patchBounds: (id: string, next: Partial<Bounds>) => void;
  maximize: (id: string) => void;
  applySnap: (id: string, which: Exclude<Snap, null>) => void;
  startMinimize: (id: string) => void;
  finishMinimize: (id: string) => void;
  restore: (id: string) => void;
  close: (id: string) => void;
  toggleOverview: (value?: boolean) => void;
  setDragging: (id: string | null) => void;
  setSnap: (snap: Snap) => void;
  restoreForDrag: (
    id: string,
    clientX: number,
    clientY: number,
    origin: { left: number; top: number },
  ) => Bounds | null;
  clearPhase: (id: string) => void;
  evenBounds: (id: string) => void;
  setCanvasSize: (cw: number, ch: number) => void;
  arrange: (layout: WmLayout) => number;
};

export type WmLayout = "tile" | "cascade" | "focus-selected";

export function even(n: number): number {
  return Math.max(2, n - (n % 2));
}

export function tile(i: number, cw: number, ch: number): Bounds {
  const w = even(Math.max(320, Math.round(cw * 0.7)));
  const h = even(Math.max(240, Math.round(ch * 0.7)));
  const x = Math.max(8, Math.round((cw - w) / 2) + i * 40);
  const y = Math.max(8, Math.round((ch - h) / 2) + i * 40);
  return { x, y, w, h, z: i + 1 };
}

export function snapRect(which: Exclude<Snap, null>, canvas: CanvasSize): Rect {
  const { cw, ch } = canvas;
  if (which === "top") {
    return {
      x: 8,
      y: 8,
      w: even(Math.max(320, cw - 16)),
      h: even(Math.max(240, ch - 88)),
    };
  }
  const w = even(Math.max(320, Math.round(cw / 2) - 12));
  const h = even(Math.max(240, ch - 96));
  return which === "left"
    ? { x: 8, y: 8, w, h }
    : { x: cw - w - 8, y: 8, w, h };
}

export function overviewTarget(
  i: number,
  n: number,
  canvas: CanvasSize,
): Rect {
  const { cw, ch } = canvas;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const pad = 24;
  const gap = 16;
  const cellW = (cw - pad * 2 - gap * (cols - 1)) / cols;
  const cellH = (ch - pad * 2 - gap * (rows - 1)) / rows;
  const col = i % cols;
  const row = Math.floor(i / cols);
  return {
    x: pad + col * (cellW + gap),
    y: pad + row * (cellH + gap),
    w: cellW,
    h: cellH,
  };
}

function clampBounds(b: Bounds, canvas: CanvasSize): Bounds {
  const { cw, ch } = canvas;
  let x = b.x;
  let y = b.y;
  let w = b.w;
  let h = b.h;
  w = Math.min(Math.max(320, w), cw);
  h = Math.min(Math.max(240, h), ch);
  x = Math.min(Math.max(0, x), Math.max(0, cw - 40));
  y = Math.min(Math.max(0, y), Math.max(0, ch - 32));
  if (x + w > cw) w = Math.max(320, cw - x);
  if (y + h > ch) h = Math.max(240, ch - y);
  return { ...b, x, y, w, h };
}

export const initialWm: WmData = {
  windows: {},
  draggingId: null,
  maximizedId: null,
  snap: null,
  overview: false,
  minimized: [],
  zTop: 1,
  lifecycle: {},
  savedBounds: {},
  canvas: { cw: 800, ch: 600 },
  knownIds: [],
};

export function pickWm(s: WmData): WmData {
  return {
    windows: s.windows,
    draggingId: s.draggingId,
    maximizedId: s.maximizedId,
    snap: s.snap,
    overview: s.overview,
    minimized: s.minimized,
    zTop: s.zTop,
    lifecycle: s.lifecycle,
    savedBounds: s.savedBounds,
    canvas: s.canvas,
    knownIds: s.knownIds,
  };
}

export function reconcileWm(
  state: WmData,
  computers: Pick<Computer, "id">[],
): { next: WmData; fresh: string[] } {
  const ids = computers.map((c) => c.id);
  const idSet = new Set(ids);
  if (
    state.knownIds.length === ids.length &&
    state.knownIds.every((id, i) => id === ids[i]) &&
    ids.every((id) => state.windows[id])
  ) {
    return { next: state, fresh: [] };
  }
  const windows = { ...state.windows };
  const lifecycle = { ...state.lifecycle };
  const savedBounds = { ...state.savedBounds };
  const fresh: string[] = [];
  const hadKnown = state.knownIds.length > 0;

  computers.forEach((c, i) => {
    if (!windows[c.id]) {
      windows[c.id] = tile(i, state.canvas.cw, state.canvas.ch);
      if (hadKnown) {
        fresh.push(c.id);
        lifecycle[c.id] = "entering";
      }
    }
  });

  for (const id of Object.keys(windows)) {
    if (!idSet.has(id)) {
      delete windows[id];
      delete lifecycle[id];
      delete savedBounds[id];
    }
  }
  for (const id of Object.keys(lifecycle)) {
    if (!idSet.has(id)) delete lifecycle[id];
  }

  const zs = Object.values(windows).map((b) => b.z);
  const zTop = zs.length > 0 ? Math.max(1, ...zs) : 1;

  return {
    next: {
      ...state,
      windows,
      lifecycle,
      savedBounds,
      zTop,
      knownIds: ids,
      minimized: state.minimized.filter((id) => idSet.has(id)),
      maximizedId:
        state.maximizedId && idSet.has(state.maximizedId)
          ? state.maximizedId
          : null,
      draggingId:
        state.draggingId && idSet.has(state.draggingId)
          ? state.draggingId
          : null,
    },
    fresh,
  };
}

export function focusWm(state: WmData, id: string): Partial<WmData> {
  const b = state.windows[id];
  if (!b) return {};
  const zTop = state.zTop + 1;
  return { zTop, windows: { ...state.windows, [id]: { ...b, z: zTop } } };
}

export function patchBoundsWm(
  state: WmData,
  id: string,
  next: Partial<Bounds>,
): Partial<WmData> {
  const b = state.windows[id];
  if (!b) return {};
  const merged = clampBounds({ ...b, ...next, z: next.z ?? b.z }, state.canvas);
  return { windows: { ...state.windows, [id]: merged } };
}

export function maximizeWm(state: WmData, id: string): Partial<WmData> {
  const { cw, ch } = state.canvas;
  const minimized = state.minimized.filter((x) => x !== id);
  if (state.maximizedId === id) {
    const prev = state.savedBounds[id];
    return {
      maximizedId: null,
      minimized,
      windows: prev ? { ...state.windows, [id]: prev } : state.windows,
    };
  }
  const b = state.windows[id];
  const savedBounds = b ? { ...state.savedBounds, [id]: b } : state.savedBounds;
  const zTop = state.zTop + 1;
  return {
    maximizedId: id,
    savedBounds,
    zTop,
    minimized,
    windows: {
      ...state.windows,
      [id]: {
        x: 8,
        y: 8,
        w: even(Math.max(320, cw - 16)),
        h: even(Math.max(240, ch - 88)),
        z: zTop,
      },
    },
  };
}

export function snapWm(
  state: WmData,
  id: string,
  which: Exclude<Snap, null>,
): Partial<WmData> {
  if (which === "top") return { ...maximizeWm(state, id), snap: null };
  const r = snapRect(which, state.canvas);
  const zTop = state.zTop + 1;
  return {
    zTop,
    snap: null,
    windows: { ...state.windows, [id]: { ...r, z: zTop } },
  };
}

export function startMinimizeWm(state: WmData, id: string): Partial<WmData> {
  return {
    lifecycle: { ...state.lifecycle, [id]: "minimizing" },
    maximizedId: state.maximizedId === id ? null : state.maximizedId,
  };
}

export function finishMinimizeWm(state: WmData, id: string): Partial<WmData> {
  const lifecycle = { ...state.lifecycle };
  delete lifecycle[id];
  return {
    lifecycle,
    minimized: state.minimized.includes(id)
      ? state.minimized
      : [...state.minimized, id],
  };
}

export function restoreWm(state: WmData, id: string): Partial<WmData> {
  if (!state.minimized.includes(id)) return {};
  return {
    minimized: state.minimized.filter((x) => x !== id),
    lifecycle: { ...state.lifecycle, [id]: "restoring" },
  };
}

export function restoreForDragWm(
  state: WmData,
  id: string,
  clientX: number,
  clientY: number,
  origin: { left: number; top: number },
): { patch: Partial<WmData>; bounds: Bounds } | null {
  const prev = state.savedBounds[id] ?? state.windows[id];
  if (!prev) return null;
  const cx = clientX - origin.left;
  const cy = clientY - origin.top;
  const next = clampBounds(
    {
      x: Math.round(cx - prev.w / 2),
      y: Math.round(cy - 19),
      w: prev.w,
      h: prev.h,
      z: prev.z,
    },
    state.canvas,
  );
  return {
    bounds: next,
    patch: {
      maximizedId: null,
      windows: { ...state.windows, [id]: next },
    },
  };
}

export function evenBoundsWm(state: WmData, id: string): Partial<WmData> {
  const b = state.windows[id];
  if (!b) return {};
  return {
    windows: {
      ...state.windows,
      [id]: { ...b, w: even(b.w), h: even(b.h) },
    },
  };
}

export function clearPhaseWm(state: WmData, id: string): Partial<WmData> {
  if (!state.lifecycle[id]) return {};
  const lifecycle = { ...state.lifecycle };
  delete lifecycle[id];
  return { lifecycle };
}

// Re-lay out all open (non-minimized) windows. Returns the affected patch and
// the number of windows arranged (0 when there are none).
export function arrangeWm(
  state: WmData,
  layout: WmLayout,
  selectedId: string | null,
): { patch: Partial<WmData>; count: number } {
  const ids = state.knownIds.filter(
    (id) => state.windows[id] && !state.minimized.includes(id),
  );
  if (ids.length === 0) return { patch: {}, count: 0 };
  const windows = { ...state.windows };
  let zTop = state.zTop;

  if (layout === "cascade") {
    ids.forEach((id, i) => {
      windows[id] = { ...tile(i, state.canvas.cw, state.canvas.ch), z: ++zTop };
    });
  } else if (layout === "tile") {
    ids.forEach((id, i) => {
      const r = overviewTarget(i, ids.length, state.canvas);
      windows[id] = {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: even(Math.round(r.w)),
        h: even(Math.round(r.h)),
        z: ++zTop,
      };
    });
  } else {
    const target = selectedId && windows[selectedId] ? selectedId : ids[0]!;
    windows[target] = { ...snapRect("top", state.canvas), z: ++zTop };
  }

  return {
    patch: { windows, zTop, maximizedId: null, snap: null },
    count: ids.length,
  };
}

export function createWmSlice(set: StoreSet, get: StoreGet): WmSlice {
  return {
    ...initialWm,
    reconcile: (computers) => {
      const current = get();
      const { next, fresh } = reconcileWm(pickWm(current), computers);
      if (
        fresh.length === 0 &&
        next.windows === current.windows &&
        next.knownIds === current.knownIds
      ) {
        return fresh;
      }
      set(next);
      return fresh;
    },
    focus: (id) => set(focusWm(pickWm(get()), id)),
    patchBounds: (id, next) => set(patchBoundsWm(pickWm(get()), id, next)),
    maximize: (id) => set(maximizeWm(pickWm(get()), id)),
    applySnap: (id, which) => set(snapWm(pickWm(get()), id, which)),
    startMinimize: (id) => set(startMinimizeWm(pickWm(get()), id)),
    finishMinimize: (id) => set(finishMinimizeWm(pickWm(get()), id)),
    restore: (id) => set(restoreWm(pickWm(get()), id)),
    close: (id) => {
      void get().destroyComputer(id);
    },
    toggleOverview: (value) =>
      set((s) => ({ overview: value === undefined ? !s.overview : value })),
    setDragging: (id) => set({ draggingId: id }),
    setSnap: (snap) => set({ snap }),
    restoreForDrag: (id, clientX, clientY, origin) => {
      const result = restoreForDragWm(
        pickWm(get()),
        id,
        clientX,
        clientY,
        origin,
      );
      if (!result) return null;
      set(result.patch);
      return result.bounds;
    },
    clearPhase: (id) => set(clearPhaseWm(pickWm(get()), id)),
    evenBounds: (id) => set(evenBoundsWm(pickWm(get()), id)),
    setCanvasSize: (cw, ch) => {
      const cur = get().canvas;
      if (cur.cw === cw && cur.ch === ch) return;
      set({ canvas: { cw, ch } });
    },
    arrange: (layout) => {
      const { patch, count } = arrangeWm(
        pickWm(get()),
        layout,
        get().selectedComputer,
      );
      if (count > 0) set(patch);
      return count;
    },
  };
}
