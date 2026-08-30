import {
  WALLPAPER_CYCLE,
  allocateName,
  type Machine,
  type SpawnSpec,
  type WallpaperId,
} from "@webmcp-computer/contract";
import { HttpError } from "./http-error.ts";
import type { ComputerHost, ComputerRecord } from "./host.ts";
import { MemoryMachine } from "./memory-machine.ts";

// Per-user quota for the in-memory host (tests/dev). Over it → 429 {quota},
// mirroring the DockerHost DB-quota split (429 quota vs 503 worker full).
const PER_USER_CAP = 4;

export class MemoryHost implements ComputerHost {
  private readonly records = new Map<string, ComputerRecord>();
  private readonly machines = new Map<string, Machine>();
  private wallpaperAt = 0;

  spawn(
    ownerId: string,
    spec: SpawnSpec,
  ): Promise<{ record: ComputerRecord; machine: Machine }> {
    const mine = [...this.records.values()].filter((r) => r.ownerId === ownerId);
    if (mine.length >= PER_USER_CAP) {
      throw new HttpError(429, { error: "quota" });
    }
    let allocated: { id: string; name: string };
    try {
      // Names are a global primary key — allocate against ALL ids.
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
      ownerId,
    };
    const machine = new MemoryMachine(record.id, record.name, wallpaper);
    this.records.set(record.id, record);
    this.machines.set(record.id, machine);
    return Promise.resolve({ record, machine });
  }

  private owned(ownerId: string, id: string): ComputerRecord | undefined {
    const r = this.records.get(id);
    return r && r.ownerId === ownerId ? r : undefined;
  }

  destroy(ownerId: string, id: string): Promise<void> {
    if (!this.owned(ownerId, id)) {
      throw new HttpError(404, { error: "unknown computer" });
    }
    this.records.delete(id);
    this.machines.delete(id);
    return Promise.resolve();
  }

  list(ownerId: string): ComputerRecord[] {
    return [...this.records.values()].filter((r) => r.ownerId === ownerId);
  }

  machine(ownerId: string, id: string): Machine | undefined {
    return this.owned(ownerId, id) ? this.machines.get(id) : undefined;
  }

  record(ownerId: string, id: string): ComputerRecord | undefined {
    return this.owned(ownerId, id);
  }

  vncUrl(_id: string): string | undefined {
    return undefined;
  }

  streamUrl(_id: string): string | undefined {
    return undefined;
  }

  streamAuth(_id: string): string | undefined {
    return undefined;
  }
}
