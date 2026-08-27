import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HttpError } from "./http-error.ts";

const execFileAsync = promisify(execFile);

export type Proc = {
  pid: number;
  cpu: string;
  mem: string;
  cmd: string;
};

export async function listProcesses(): Promise<{ processes: Proc[] }> {
  const { stdout } = await execFileAsync(
    "ps",
    ["-eo", "pid,pcpu,pmem,args", "--no-headers"],
    { timeout: 5_000 },
  );
  const processes: Proc[] = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    processes.push({
      pid: Number(m[1]),
      cpu: m[2] ?? "0",
      mem: m[3] ?? "0",
      cmd: (m[4] ?? "").slice(0, 120),
    });
    if (processes.length >= 80) break;
  }
  return { processes };
}

export async function killProcess(pid: number): Promise<{ pid: number }> {
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new HttpError(400, { error: "invalid pid" });
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    throw new HttpError(404, { error: "no such process" });
  }
  return { pid };
}

export type Port = { port: number; proto: string; addr: string };

export async function listPorts(): Promise<{ ports: Port[] }> {
  let stdout = "";
  try {
    const r = await execFileAsync("ss", ["-lntuH"], { timeout: 5_000 });
    stdout = r.stdout;
  } catch {
    try {
      const r = await execFileAsync("ss", ["-lntu"], { timeout: 5_000 });
      stdout = r.stdout;
    } catch {
      return { ports: [] };
    }
  }
  const ports: Port[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split("\n")) {
    const proto = line.startsWith("tcp")
      ? "tcp"
      : line.startsWith("udp")
        ? "udp"
        : "";
    const m = line.match(/(\d+\.\d+\.\d+\.\d+|\[::\]|\*|::):(\d+)\s/);
    if (!proto || !m?.[2]) continue;
    const port = Number(m[2]);
    const addr = m[1] ?? "*";
    const key = `${proto}:${addr}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ports.push({ port, proto, addr });
  }
  return { ports };
}

export async function devServers(): Promise<{
  servers: { url: string; port: number }[];
}> {
  const { ports } = await listPorts();
  const local = ports.filter(
    (p) =>
      p.proto === "tcp" &&
      (p.addr === "127.0.0.1" ||
        p.addr === "0.0.0.0" ||
        p.addr === "*" ||
        p.addr === "[::]"),
  );
  const servers = local.map((p) => ({
    port: p.port,
    url: `http://127.0.0.1:${p.port}`,
  }));
  return { servers };
}

export async function installPackage(
  name: string,
): Promise<{ name: string; stdout: string }> {
  if (!/^[a-zA-Z0-9.+-]+$/.test(name)) {
    throw new HttpError(400, { error: "invalid package name" });
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      "apt-get",
      ["install", "-y", name],
      {
        timeout: 120_000,
        env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
      },
    );
    return { name, stdout: (stdout + stderr).slice(0, 4000) };
  } catch (err) {
    throw new HttpError(502, {
      error: err instanceof Error ? err.message : "install failed",
    });
  }
}

export async function notify(title: string, body: string): Promise<void> {
  try {
    await execFileAsync("notify-send", [title, body], {
      timeout: 3_000,
      env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":1" },
    });
  } catch {
    /* xfce notify is optional */
  }
}
