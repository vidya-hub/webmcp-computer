import { setSoundEnabled, soundEnabled } from "../../ui/sound.ts";
import type { StoreSet } from "../types.ts";

const BOOT_KEY = "webmcp.booted";
const PERSIST_KEY = "webmcp-ui";

function readBooted(): boolean {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        state?: { booted?: boolean };
      };
      if (typeof parsed.state?.booted === "boolean") return parsed.state.booted;
    }
  } catch {
    /* ignore */
  }
  try {
    return sessionStorage.getItem(BOOT_KEY) === "1";
  } catch {
    return true;
  }
}

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

export type UiSlice = {
  booted: boolean;
  justBooted: boolean;
  idle: boolean;
  timelineOpen: boolean;
  sound: boolean;
  bootNonce: number;
  finishBoot: () => void;
  replayBoot: () => void;
  setIdle: (idle: boolean) => void;
  setTimelineOpen: (open: boolean) => void;
  setSound: (on: boolean) => void;
};

export function createUiSlice(set: StoreSet): UiSlice {
  return {
    booted: readBooted(),
    justBooted: false,
    idle: false,
    timelineOpen: false,
    sound: readSound(),
    bootNonce: 0,
    finishBoot: () => {
      set({ booted: true, justBooted: true });
      window.setTimeout(() => set({ justBooted: false }), 2200);
    },
    replayBoot: () => set((s) => ({ booted: false, bootNonce: s.bootNonce + 1 })),
    setIdle: (idle) => set({ idle }),
    setTimelineOpen: (open) => set({ timelineOpen: open }),
    setSound: (on) => {
      setSoundEnabled(on);
      set({ sound: on });
    },
  };
}

export function syncSoundFromPersist(sound: boolean): void {
  setSoundEnabled(sound);
}
