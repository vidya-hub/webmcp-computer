import {
  type Computer,
  type ComputerId,
  type Machine,
  type SpawnSpec,
  type WallpaperId,
} from "@webmcp-computer/contract";

export type ComputerRecord = Computer & {
  // Owning session userId. Never serialized to the browser (publicComputer
  // strips it); it is the tenancy key for every host lookup.
  ownerId: string;
  wallpaper: WallpaperId;
  vncUrl?: string;
  streamUrl?: string;
  streamAuth?: string;
};

export interface ComputerHost {
  spawn(
    ownerId: string,
    spec: SpawnSpec,
  ): Promise<{ record: ComputerRecord; machine: Machine }>;
  destroy(ownerId: string, id: ComputerId): Promise<void>;
  list(ownerId: string): ComputerRecord[];
  machine(ownerId: string, id: ComputerId): Machine | undefined;
  record(ownerId: string, id: ComputerId): ComputerRecord | undefined;
  // Owner-agnostic: the desktop proxy uses these AFTER the route has checked
  // ownership, so they only need the id.
  vncUrl(id: ComputerId): string | undefined;
  // Product H.264 stream (Selkies). Undefined until the guest publishes :6902.
  // Never serialize streamAuth to the browser — the API injects it upstream.
  streamUrl?(id: ComputerId): string | undefined;
  streamAuth?(id: ComputerId): string | undefined;
  // Fired when a record is inserted or its status changes (e.g. starting →
  // running during spawn) so the plane can WS-emit a public Computer.
  subscribeRecords?(listener: (record: ComputerRecord) => void): () => void;
  // Home persistence (docker-only). archiveHome tars the guest home and returns
  // the gzip bytes, aborting past capBytes. restoreHome extracts into it.
  archiveHome?(
    id: ComputerId,
    excludes: string[],
    capBytes: number,
  ): Promise<Buffer>;
  restoreHome?(id: ComputerId, tar: Buffer): Promise<void>;
}
