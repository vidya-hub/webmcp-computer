import { execFile, spawn } from "node:child_process";
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
import { pool } from "./pg.ts";
import { redis } from "./redis.ts";

const execFileAsync = promisify(execFile);
const IMAGE = process.env.COMPUTER_IMAGE ?? "webmcp-slim:local";
const WORKER_ID = process.env.WORKER_ID ?? "worker-0";
const SKU = "desktop.standard";
const DEFAULT_QUOTA = Number(process.env.DEFAULT_QUOTA_COMPUTERS ?? 4);

function vncUrlFor(port: string, imageName = IMAGE): string {
  const scheme =
    process.env.VNC_SCHEME ??
    (imageName.startsWith("webmcp-kasm") ? "https" : "http");
  return `${scheme}://127.0.0.1:${port}`;
}

function streamUrlFor(port: string): string {
  return `http://127.0.0.1:${port}`;
}

function streamAuthFor(token: string): string {
  return `Basic ${Buffer.from(`selkies:${token}`).toString("base64")}`;
}

async function optionalPort(cname: string, spec: string): Promise<string | undefined> {
  try {
    return parsePort((await dk(["port", cname, spec])).stdout);
  } catch {
    return undefined;
  }
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
      const res = await fetch(`http://127.0.0.1:${bridgePort}/health`, {
        // A hung TCP read (e.g. docker pause) must not block the deadline loop.
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return;
      last = String(res.status);
    } catch (err) {
      last = err instanceof Error ? err.message : "fetch failed";
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new HttpError(502, { error: `bridge not healthy: ${last}` });
}

async function waitSelkies(
  port: string,
  token: string,
  ms: number,
): Promise<void> {
  const deadline = Date.now() + ms;
  const auth = streamAuthFor(token);
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { authorization: auth },
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return;
      last = String(res.status);
    } catch (err) {
      last = err instanceof Error ? err.message : "fetch failed";
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new HttpError(502, { error: `selkies not healthy: ${last}` });
}

function envMap(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

function maxComputers(): number {
  const v = Number(process.env.MAX_COMPUTERS);
  return Number.isFinite(v) && v > 0 ? v : MAX_COMPUTERS;
}

export class DockerHost implements ComputerHost {
  private readonly records = new Map<string, ComputerRecord>();
  private readonly machines = new Map<string, Machine>();
  private wallpaperAt = 0;
  // In-flight spawn reservations (Node is single-threaded, so a counter + set
  // guarded synchronously before the first await is a sufficient mutex).
  private pending = 0;
  private readonly pendingIds = new Set<string>();
  private readonly recordListeners = new Set<(r: ComputerRecord) => void>();

  subscribeRecords(listener: (record: ComputerRecord) => void): () => void {
    this.recordListeners.add(listener);
    return () => this.recordListeners.delete(listener);
  }

  private publishRecord(record: ComputerRecord): void {
    for (const listener of this.recordListeners) listener(record);
  }

  async reconcile(): Promise<void> {
    let rows = "";
    try {
      const { stdout } = await dk([
        "ps",
        "-a",
        "--filter",
        "label=webmcp.computer=1",
        "--format",
        "{{.Names}}\t{{.State}}",
      ]);
      rows = stdout;
    } catch {
      return;
    }
    for (const row of rows.trim().split("\n").filter(Boolean)) {
      const [cname, state] = row.split("\t");
      if (!cname) continue;
      const id = cname.replace(/^webmcp-/, "");
      // Desktops are ephemeral (spec §13). A stopped/created corpse is invisible
      // to the API and its name blocks re-use — remove it instead of adopting.
      if (state !== "running") {
        await dk(["rm", "-f", cname]).catch(() => undefined);
        continue;
      }
      try {
        // Owner label is the tenancy key. A container from before this pass has
        // none — remove it (approved 003 leftover policy); never adopt an
        // unowned guest into a tenant's view.
        const { stdout: ownerOut } = await dk([
          "inspect",
          "-f",
          '{{index .Config.Labels "webmcp.owner"}}',
          cname,
        ]);
        const ownerId = ownerOut.trim();
        if (!ownerId || ownerId === "<no value>") {
          await dk(["rm", "-f", cname]).catch(() => undefined);
          continue;
        }
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
        const streamPort = await optionalPort(cname, "6902/tcp");
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
          ownerId,
          vncUrl: vncUrlFor(vnc, imageOut.trim()),
          streamUrl: streamPort ? streamUrlFor(streamPort) : undefined,
          streamAuth:
            streamPort && env.MACHINE_TOKEN
              ? streamAuthFor(env.MACHINE_TOKEN)
              : undefined,
        };
        this.records.set(record.id, record);
        this.machines.set(
          record.id,
          new HttpMachine(`http://127.0.0.1:${bridge}`, env.MACHINE_TOKEN),
        );
        this.wallpaperAt += 1;
      } catch {
        /* skip unreadable container */
      }
    }
  }

  async spawn(
    ownerId: string,
    spec: SpawnSpec,
  ): Promise<{ record: ComputerRecord; machine: Machine }> {
    // Worker capacity for THIS box (503 worker full) — distinct from the
    // per-user DB quota (429), which reserveQuota enforces.
    if (this.records.size + this.pending >= maxComputers()) {
      throw new HttpError(503, { error: "worker full" });
    }
    let allocated: { id: string; name: string };
    try {
      allocated = allocateName(
        spec.name,
        new Set([...this.records.keys(), ...this.pendingIds]).values(),
      );
    } catch {
      throw new HttpError(400, { error: "invalid name" });
    }
    this.pending += 1;
    this.pendingIds.add(allocated.id);
    try {
      // Atomically check the per-user quota and insert the computers row under a
      // short Redis lock; the row is the durable concurrent-spawn guard.
      await this.reserveQuota(ownerId, allocated.id, allocated.name);
      try {
        return await this.spawnReserved(ownerId, spec, allocated);
      } catch (err) {
        await pool
          .query("delete from computers where id = $1 and user_id = $2", [
            allocated.id,
            ownerId,
          ])
          .catch(() => undefined);
        throw err;
      }
    } finally {
      this.pending -= 1;
      this.pendingIds.delete(allocated.id);
    }
  }

  // Redis lock guards only the quota read + row insert (fast); it is released
  // before the long docker run. The inserted computers row (status 'starting')
  // is what a concurrent spawn counts against, so quota holds without holding
  // the lock across the whole spawn.
  private async reserveQuota(
    ownerId: string,
    id: string,
    name: string,
  ): Promise<void> {
    const lockKey = `spawn:${ownerId}`;
    const locked = await redis.set(lockKey, "1", "EX", 30, "NX");
    if (!locked) {
      throw new HttpError(429, { error: "spawn in progress" });
    }
    try {
      const { rows } = await pool.query<{ max_computers: number }>(
        "select max_computers from quotas where user_id = $1",
        [ownerId],
      );
      const max = rows[0]?.max_computers ?? DEFAULT_QUOTA;
      const { rows: cnt } = await pool.query<{ n: number }>(
        "select count(*)::int as n from computers where user_id = $1",
        [ownerId],
      );
      if ((cnt[0]?.n ?? 0) >= max) {
        throw new HttpError(429, { error: "quota" });
      }
      await pool.query(
        `insert into computers (id, user_id, worker_id, sku, name, status)
         values ($1,$2,$3,$4,$5,'starting')`,
        [id, ownerId, WORKER_ID, SKU, name],
      );
    } finally {
      await redis.del(lockKey).catch(() => undefined);
    }
  }

  private async spawnReserved(
    ownerId: string,
    spec: SpawnSpec,
    allocated: { id: string; name: string },
  ): Promise<{ record: ComputerRecord; machine: Machine }> {
    const wallpaper = WALLPAPER_CYCLE[
      this.wallpaperAt % WALLPAPER_CYCLE.length
    ] as WallpaperId;
    this.wallpaperAt += 1;
    const cname = `webmcp-${allocated.id}`;
    // Per-container secret: the bridge (and VNC path) sit on the shared docker
    // bridge network reachable by sibling containers. HttpMachine sends this as
    // a bearer token so only the control plane can drive a guest.
    const token = crypto.randomUUID();
    try {
      await dk(
        [
          "run",
          "-d",
          "--name",
          cname,
          "--label",
          "webmcp.computer=1",
          "--label",
          `webmcp.owner=${ownerId}`,
          "--label",
          `webmcp.sku=${SKU}`,
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
          // No SYS_ADMIN / apparmor=unconfined / /dev/fuse: those existed only
          // for a cosmetic in-guest `df` and were near container-escape risk.
          "--security-opt",
          "no-new-privileges",
          "-p",
          "127.0.0.1:0:6901",
          "-p",
          "127.0.0.1:0:6902",
          "-p",
          "127.0.0.1:0:8080",
          "-e",
          `MACHINE_ID=${allocated.id}`,
          "-e",
          `MACHINE_NAME=${allocated.name}`,
          "-e",
          `MACHINE_TOKEN=${token}`,
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
    let stream: string;
    try {
      vnc = parsePort((await dk(["port", cname, "6901/tcp"])).stdout);
      bridge = parsePort((await dk(["port", cname, "8080/tcp"])).stdout);
      stream = parsePort((await dk(["port", cname, "6902/tcp"])).stdout);
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
      ownerId,
      vncUrl: vncUrlFor(vnc, IMAGE),
      streamUrl: streamUrlFor(stream),
      streamAuth: streamAuthFor(token),
    };
    const machine = new HttpMachine(`http://127.0.0.1:${bridge}`, token);
    this.records.set(record.id, record);
    this.machines.set(record.id, machine);
    this.publishRecord(record);
    try {
      await waitHealthy(bridge, 60_000);
      await waitSelkies(stream, token, 20_000);
      record.status = "running";
      await pool
        .query(
          "update computers set status = 'running' where id = $1 and user_id = $2",
          [allocated.id, ownerId],
        )
        .catch(() => undefined);
      this.publishRecord(record);
    } catch (err) {
      // A failed health check must not leave a running container that burns a
      // MAX_COMPUTERS slot forever. Capture logs for diagnosis, then remove it.
      const logs = await dk(["logs", "--tail", "50", cname]).catch(
        () => undefined,
      );
      if (logs) {
        console.error(`spawn ${cname} unhealthy; last logs:\n${logs.stdout}${logs.stderr}`);
      }
      await dk(["rm", "-f", cname]).catch(() => undefined);
      this.records.delete(record.id);
      this.machines.delete(record.id);
      throw err;
    }
    return { record, machine };
  }

  async destroy(ownerId: string, id: string): Promise<void> {
    const rec = this.records.get(id);
    if (!rec || rec.ownerId !== ownerId) {
      throw new HttpError(404, { error: "unknown computer" });
    }
    const cname = `webmcp-${id}`;
    try {
      await dk(["rm", "-f", cname]);
    } catch (err) {
      // Don't drop the record if the container might still exist — that would
      // orphan it (invisible to the API, name/ports held forever).
      const still = await dk(["inspect", cname]).then(
        () => true,
        () => false,
      );
      if (still) {
        rec.status = "error";
        throw new HttpError(502, {
          error: err instanceof Error ? err.message : "docker rm failed",
        });
      }
    }
    this.records.delete(id);
    this.machines.delete(id);
    await pool
      .query("delete from computers where id = $1 and user_id = $2", [
        id,
        ownerId,
      ])
      .catch(() => undefined);
  }

  async archiveHome(
    id: string,
    excludes: string[],
    capBytes: number,
  ): Promise<Buffer> {
    if (!this.records.has(id)) {
      throw new HttpError(404, { error: "unknown computer" });
    }
    const cname = `webmcp-${id}`;
    // Resolve the guest home from uid 1000 (username is renamed per-boot, uid
    // is stable), tar it gzipped to stdout, excluding caches/browser profile.
    const excl = excludes.map((e) => `--exclude=./${e}`).join(" ");
    const script = `H=$(getent passwd 1000 | cut -d: -f6); cd "$H" && tar czf - ${excl} .`;
    const child = spawn("docker", ["exec", cname, "sh", "-c", script]);
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let aborted = false;
      let stderr = "";
      child.stdout.on("data", (b: Buffer) => {
        total += b.length;
        if (total > capBytes) {
          aborted = true;
          child.kill("SIGKILL");
          reject(
            new HttpError(400, {
              error: `home exceeds ${Math.round(capBytes / 1e6)}MB archive cap`,
            }),
          );
          return;
        }
        chunks.push(b);
      });
      child.stderr.on("data", (b: Buffer) => {
        stderr += b.toString();
      });
      child.on("error", (err) =>
        reject(new HttpError(502, { error: err.message })),
      );
      child.on("close", (code) => {
        if (aborted) return;
        if (code !== 0) {
          reject(new HttpError(502, { error: stderr || `tar exited ${code}` }));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
  }

  async restoreHome(id: string, tar: Buffer): Promise<void> {
    if (!this.records.has(id)) {
      throw new HttpError(404, { error: "unknown computer" });
    }
    const cname = `webmcp-${id}`;
    // Extract over the guest home; the browser profile is excluded from archives
    // so this can't clobber a running Chromium. Fix ownership afterward.
    const script = `H=$(getent passwd 1000 | cut -d: -f6); mkdir -p "$H" && tar xzf - -C "$H" && chown -R 1000:1000 "$H"`;
    const child = spawn("docker", ["exec", "-i", cname, "sh", "-c", script]);
    return new Promise<void>((resolve, reject) => {
      let stderr = "";
      child.stderr.on("data", (b: Buffer) => {
        stderr += b.toString();
      });
      child.on("error", (err) =>
        reject(new HttpError(502, { error: err.message })),
      );
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new HttpError(502, { error: stderr || `extract exited ${code}` }));
      });
      child.stdin.on("error", () => {
        /* broken pipe if the child died; close handler reports it */
      });
      child.stdin.end(tar);
    });
  }

  list(ownerId: string): ComputerRecord[] {
    return [...this.records.values()].filter((r) => r.ownerId === ownerId);
  }

  private owned(ownerId: string, id: string): ComputerRecord | undefined {
    const r = this.records.get(id);
    return r && r.ownerId === ownerId ? r : undefined;
  }

  machine(ownerId: string, id: string): Machine | undefined {
    return this.owned(ownerId, id) ? this.machines.get(id) : undefined;
  }

  record(ownerId: string, id: string): ComputerRecord | undefined {
    return this.owned(ownerId, id);
  }

  vncUrl(id: string): string | undefined {
    return this.records.get(id)?.vncUrl;
  }

  streamUrl(id: string): string | undefined {
    return this.records.get(id)?.streamUrl;
  }

  streamAuth(id: string): string | undefined {
    return this.records.get(id)?.streamAuth;
  }
}
