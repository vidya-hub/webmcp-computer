import {
  type Computer,
  type ComputerId,
  type Machine,
  type SpawnSpec,
  type WallpaperId,
} from "@webmcp-computer/contract";

export type ComputerRecord = Computer & {
  wallpaper: WallpaperId;
  vncUrl?: string;
};

export interface ComputerHost {
  spawn(spec: SpawnSpec): Promise<{ record: ComputerRecord; machine: Machine }>;
  destroy(id: ComputerId): Promise<void>;
  list(): ComputerRecord[];
  machine(id: ComputerId): Machine | undefined;
  record(id: ComputerId): ComputerRecord | undefined;
  vncUrl(id: ComputerId): string | undefined;
}
