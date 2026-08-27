/// <reference types="vite/client" />

interface ModelContext {
  registerTool: (
    def: unknown,
    opts?: { signal?: AbortSignal },
  ) => Promise<void>;
  getTools?: () => { name: string }[];
}

interface Document {
  modelContext?: ModelContext;
}

interface Navigator {
  modelContext?: ModelContext;
}
