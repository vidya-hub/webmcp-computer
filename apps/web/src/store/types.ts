import type { ServerSlice } from "./slices/server.ts";
import type { UiSlice } from "./slices/ui.ts";
import type { WmSlice } from "./slices/wm.ts";

export type Bounds = { x: number; y: number; w: number; h: number; z: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Snap = "left" | "right" | "top" | null;
export type Phase = "entering" | "closing" | "minimizing" | "restoring";
export type CanvasSize = { cw: number; ch: number };

export type AppStore = ServerSlice & WmSlice & UiSlice;

export type StoreSet = (
  partial: Partial<AppStore> | ((state: AppStore) => Partial<AppStore>),
) => void;
export type StoreGet = () => AppStore;
