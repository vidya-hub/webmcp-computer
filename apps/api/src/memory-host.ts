import {
  MAX_COMPUTERS,
  WALLPAPER_CYCLE,
  allocateName,
  type Machine,
  type SpawnSpec,
  type WallpaperId,
} from "@webmcp-computer/contract";
import { HttpError } from "./http-error.ts";
import type { ComputerHost, ComputerRecord } from "./host.ts";
import { MemoryMachine } from "./memory-machine.ts";

export class MemoryHost implements ComputerHost {
  private readonly records = new Map<string, ComputerRecord>();
  private readonly machines = new Map<string, Machine>();
  private wallpaperAt = 0;

  spawn(spec: SpawnSpec): Promise<{ record: ComputerRecord; machine: Machine }> {
    if (this.records.size >= MAX_COMPUTERS) {
      throw new HttpError(409, { error: "computer cap reached" });
    }
    let allocated: { id: string; name: string };
    try {
      allocated = allocateName(spec.name, this.records.keys());
    } catch {
      throw new HttpError(400, { error: "invalid name" });
    }
    const wallpaper = WALLPAPER_CYCLE[
      this.wallpaperAt % WALLPAPER_CYCLE.length
    ] as WallpaperId;
    this.wallpaperAt += 1;
    const record: ComputerRecord = {
      id: allocated.id,
      name: allocated.name,
      status: "running",
      os: "Ubuntu 24.04",
      role: spec.role?.trim() || "computer",
      wallpaper,
    };
    const machine = new MemoryMachine(record.id, record.name, wallpaper);
    this.records.set(record.id, record);
    this.machines.set(record.id, machine);
    return Promise.resolve({ record, machine });
  }

  destroy(id: string): Promise<void> {
    if (!this.records.has(id)) {
      throw new HttpError(404, { error: "unknown computer" });
    }
    this.records.delete(id);
    this.machines.delete(id);
    return Promise.resolve();
  }

  list(): ComputerRecord[] {
    return [...this.records.values()];
  }

  machine(id: string): Machine | undefined {
    return this.machines.get(id);
  }

  record(id: string): ComputerRecord | undefined {
    return this.records.get(id);
  }

  vncUrl(_id: string): string | undefined {
    return undefined;
  }
}
