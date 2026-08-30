import { play, setSoundEnabled, soundEnabled, stopAll } from "../../ui/sound.ts";
import type { StoreGet, StoreSet } from "../types.ts";

const PERSIST_KEY = "webmcp-ui";

export type InspectorTab = "tape" | "recipes";

function readSound(): boolean {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        state?: { sound?: boolean };
      };
      if (typeof parsed.state?.sound === "boolean") return parsed.state.sound;
    }
  } catch {
    /* ignore */
  }
  return soundEnabled();
}

export type Session = { email: string };

export type UiSlice = {
  // In-memory only (never persisted): the authenticated session, if any.
  session: Session | null;
  setSession: (session: Session | null) => void;
  idle: boolean;
  timelineOpen: boolean;
  inspectorTab: InspectorTab;
  tapeFilter: string;
  tapeFocusNonce: number;
  recipeFocusId: string | null;
  toastsVisible: boolean;
  sound: boolean;
  streamFps: Record<string, number>;
  setStreamFps: (id: string, fps: number | null) => void;
  setIdle: (idle: boolean) => void;
  openInspector: (
    tab: InspectorTab,
    opts?: { filter?: string; focusNewest?: boolean; recipeId?: string },
  ) => void;
  closeInspector: () => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setTapeFilter: (filter: string) => void;
  setToastsVisible: (visible: boolean) => void;
  setSound: (on: boolean) => void;
};

export function createUiSlice(set: StoreSet, get: StoreGet): UiSlice {
  return {
    session: null,
    setSession: (session) => set({ session }),
    idle: false,
    timelineOpen: false,
    inspectorTab: "tape",
    tapeFilter: "all",
    tapeFocusNonce: 0,
    recipeFocusId: null,
    toastsVisible: false,
    sound: readSound(),
    streamFps: {},
    setStreamFps: (id, fps) => {
      const cur = get().streamFps[id];
      if (fps == null) {
        if (cur == null) return;
        const next = { ...get().streamFps };
        delete next[id];
        set({ streamFps: next });
        return;
      }
      if (cur === fps) return;
      set({ streamFps: { ...get().streamFps, [id]: fps } });
    },
    setIdle: (idle) => set({ idle }),
    openInspector: (tab, opts) => {
      const s = get();
      const was = s.timelineOpen;
      set({
        timelineOpen: true,
        inspectorTab: tab,
        tapeFilter: opts?.filter ?? (tab === "tape" ? "all" : s.tapeFilter),
        tapeFocusNonce: opts?.focusNewest ? s.tapeFocusNonce + 1 : s.tapeFocusNonce,
        recipeFocusId: opts?.recipeId ?? s.recipeFocusId,
      });
      if (!was) play("open");
    },
    closeInspector: () => {
      if (!get().timelineOpen) return;
      set({ timelineOpen: false });
      play("close");
    },
    setInspectorTab: (tab) => set({ inspectorTab: tab }),
    setTapeFilter: (filter) => set({ tapeFilter: filter }),
    setToastsVisible: (visible) => set({ toastsVisible: visible }),
    setSound: (on) => {
      if (on) {
        setSoundEnabled(true);
        set({ sound: true });
        play("toggle-on");
      } else {
        play("toggle-off");
        stopAll();
        setSoundEnabled(false);
        set({ sound: false });
      }
    },
  };
}

export function syncSoundFromPersist(sound: boolean): void {
  setSoundEnabled(sound);
}
