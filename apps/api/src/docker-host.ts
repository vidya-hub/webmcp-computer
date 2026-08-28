import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  COMPUTER_CPUS,
  COMPUTER_DISK_BYTES,
  COMPUTER_MEMORY,
  COMPUTER_MEMORY_BYTES,
  COMPUTER_SHM,
  MAX_COMPUTERS,
  WALLPAPER_CYCLE,
  allocateName,
  type Machine,
  type SpawnSpec,
  type WallpaperId,
} from "@webmcp-computer/contract";
import { HttpError } from "./http-error.ts";
import type { ComputerHost, ComputerRecord } from "./host.ts";
import { HttpMachine } from "./http-machine.ts";

const execFileAsync = promisify(execFile);
const IMAGE = process.env.COMPUTER_IMAGE ?? "webmcp-slim:local";

function vncUrlFor(port: string, imageName = IMAGE): string {
  const scheme =
    process.env.VNC_SCHEME ??
    (imageName.startsWith("webmcp-kasm") ? "https" : "http");
  return `${scheme}://127.0.0.1:${port}`;
}

function dk(args: string[], timeout = 20_000) {
  return execFileAsync("docker", args, { timeout });
}

function parsePort(stdout: string): string {
  const line = stdout.trim().split("\n")[0] ?? "";
  const m = line.match(/:(\d+)\s*$/) ?? line.match(/(\d+)\s*$/);
  if (!m?.[1]) throw new Error(`no host port in: ${line}`);
  return m[1];
}

async function waitHealthy(bridgePort: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${bridgePort}/health`);
      if (res.ok) return;
      last = String(res.status);
    } catch (err) {
      last = err instanceof Error ? err.message : "fetch failed";
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new HttpError(502, { error: `bridge not healthy: ${last}` });
}

function envMap(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

export class DockerHost implements ComputerHost {
  private readonly records = new Map<string, ComputerRecord>();
  private readonly machines = new Map<string, Machine>();
  private wallpaperAt = 0;

  async reconcile(): Promise<void> {
    let names = "";
    try {
      const { stdout } = await dk([
        "ps",
        "-q",
        "--filter",
        "label=webmcp.computer=1",
        "--format",
        "{{.Names}}",
      ]);
      names = stdout;
    } catch {
      return;
    }
    for (const cname of names.trim().split("\n").filter(Boolean)) {
      const id = cname.replace(/^webmcp-/, "");
      try {
        const { stdout: envOut } = await dk([
          "inspect",
          "-f",
          "{{range .Config.Env}}{{println .}}{{end}}",
          cname,
        ]);
        const env = envMap(envOut.split("\n"));
        const { stdout: imageOut } = await dk([
          "inspect",
          "-f",
          "{{.Config.Image}}",
          cname,
        ]);
        const vnc = parsePort((await dk(["port", cname, "6901/tcp"])).stdout);
        const bridge = parsePort((await dk(["port", cname, "8080/tcp"])).stdout);
        const wallpaper = (
          WALLPAPER_CYCLE.includes(env.WALLPAPER as (typeof WALLPAPER_CYCLE)[number])
            ? env.WALLPAPER
            : "carbon"
        ) as WallpaperId;
        const record: ComputerRecord = {
          id: env.MACHINE_ID || id,
          name: env.MACHINE_NAME || env.MACHINE_ID || id,
          status: "running",
          os: "Ubuntu 24.04",
          role: "computer",
          wallpaper,
          vncUrl: vncUrlFor(vnc, imageOut.trim()),
        };
        this.records.set(record.id, record);
        this.machines.set(record.id, new HttpMachine(`http://127.0.0.1:${bridge}`));
        this.wallpaperAt += 1;
      } catch {
        /* skip unreadable container */
      }
    }
  }

  async spawn(
    spec: SpawnSpec,
  ): Promise<{ record: ComputerRecord; machine: Machine }> {
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
    const cname = `webmcp-${allocated.id}`;
    try {
      await dk(
        [
          "run",
          "-d",
          "--name",
          cname,
          "--label",
          "webmcp.computer=1",
          "--shm-size",
          COMPUTER_SHM,
          "--memory",
          COMPUTER_MEMORY,
          "--memory-swap",
          COMPUTER_MEMORY,
          "--cpus",
          COMPUTER_CPUS,
          "--pids-limit",
          "512",
          "--device",
          "/dev/fuse",
          "--cap-add",
          "SYS_ADMIN",
          "--security-opt",
          "apparmor=unconfined",
          "-p",
          "127.0.0.1:0:6901",
          "-p",
          "127.0.0.1:0:8080",
          "-e",
          `MACHINE_ID=${allocated.id}`,
          "-e",
          `MACHINE_NAME=${allocated.name}`,
          "-e",
          `WALLPAPER=${wallpaper}`,
          "-e",
          `WEBMCP_MEMORY_BYTES=${COMPUTER_MEMORY_BYTES}`,
          "-e",
          `WEBMCP_DISK_BYTES=${COMPUTER_DISK_BYTES}`,
          "-e",
          "VNC_PW=password",
          IMAGE,
        ],
        60_000,
      );
    } catch (err) {
      throw new HttpError(502, {
        error: err instanceof Error ? err.message : "docker run failed",
      });
    }
    let vnc: string;
    let bridge: string;
    try {
      vnc = parsePort((await dk(["port", cname, "6901/tcp"])).stdout);
      bridge = parsePort((await dk(["port", cname, "8080/tcp"])).stdout);
    } catch (err) {
      await dk(["rm", "-f", cname]).catch(() => undefined);
      throw new HttpError(502, {
        error: err instanceof Error ? err.message : "docker port failed",
      });
    }
    const record: ComputerRecord = {
      id: allocated.id,
      name: allocated.name,
      status: "starting",
      os: "Ubuntu 24.04",
      role: spec.role?.trim() || "computer",
      wallpaper,
      vncUrl: vncUrlFor(vnc, IMAGE),
    };
    const machine = new HttpMachine(`http://127.0.0.1:${bridge}`);
    this.records.set(record.id, record);
    this.machines.set(record.id, machine);
    try {
      await waitHealthy(bridge, 60_000);
      record.status = "running";
    } catch (err) {
      record.status = "error";
      throw err;
    }
    return { record, machine };
  }

  async destroy(id: string): Promise<void> {
    if (!this.records.has(id)) {
      throw new HttpError(404, { error: "unknown computer" });
    }
    await dk(["rm", "-f", `webmcp-${id}`]).catch(() => undefined);
    this.records.delete(id);
    this.machines.delete(id);
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

  vncUrl(id: string): string | undefined {
    return this.records.get(id)?.vncUrl;
  }
}
