import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createServerSlice } from "./slices/server.ts";
import { createUiSlice, syncSoundFromPersist } from "./slices/ui.ts";
import { createWmSlice } from "./slices/wm.ts";
import type { AppStore } from "./types.ts";

export type { AppStore } from "./types.ts";

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      ...createServerSlice(set, get),
      ...createWmSlice(set, get),
      ...createUiSlice(set, get),
    }),
    {
      name: "webmcp-ui",
      partialize: (s) => ({ sound: s.sound }),
      onRehydrateStorage: () => (state) => {
        if (state) syncSoundFromPersist(state.sound);
      },
    },
  ),
);

export const store = useStore;
