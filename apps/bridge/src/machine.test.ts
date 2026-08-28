import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "./app.ts";
import { LinuxMachine } from "./linux-machine.ts";

const jail = fs.mkdtempSync(path.join(os.tmpdir(), "webmcp-jail-"));
const prev = {
  HOME_JAIL: process.env.HOME_JAIL,
  ALLOW_JSON_APPEARANCE: process.env.ALLOW_JSON_APPEARANCE,
  MACHINE_ID: process.env.MACHINE_ID,
  MACHINE_NAME: process.env.MACHINE_NAME,
};

before(() => {
  process.env.HOME_JAIL = jail;
  process.env.ALLOW_JSON_APPEARANCE = "1";
  process.env.MACHINE_ID = "unit-1";
  process.env.MACHINE_NAME = "unit-1";
  fs.writeFileSync(
    path.join(jail, "package.json"),
    `${JSON.stringify(
      {
        name: "jail-fixture",
        private: true,
        scripts: {
          dev: "node -e \"console.log('ready'); setInterval(()=>{},1e9)\"",
        },
      },
      null,
      2,
    )}\n`,
  );
});

after(() => {
  process.env.HOME_JAIL = prev.HOME_JAIL;
  process.env.ALLOW_JSON_APPEARANCE = prev.ALLOW_JSON_APPEARANCE;
  process.env.MACHINE_ID = prev.MACHINE_ID;
  process.env.MACHINE_NAME = prev.MACHINE_NAME;
  fs.rmSync(jail, { recursive: true, force: true });
});

function machine() {
  return new LinuxMachine("unit-1", "unit-1");
}

test("write/read round-trip and jail", async () => {
  const m = machine();
  const file = path.join(jail, "hello.txt");
  const written = await m.writeFile(file, "hi");
  assert.equal(written.path, fs.realpathSync(file));
  const read = await m.readFile(file);
  assert.equal(read.content, "hi");
  await assert.rejects(
    () => m.writeFile("/etc/passwd", "no"),
    (err: Error) => err.message === "path outside jail",
  );
});

test("run ls exits 0", async () => {
  const m = machine();
  const result = await m.run("ls", jail);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /package\.json/);
});

test("browser empty when CDP is down", async () => {
  const m = machine();
  const state = await m.browser();
  assert.equal(state.activeTab, null);
  assert.deepEqual(state.tabs, []);
});

test("detach npm run dev", async () => {
  const m = machine();
  const result = await m.run("npm run dev", jail);
  try {
    assert.equal(result.exitCode, null);
    assert.equal(result.running, true);
    assert.ok(result.pid);
    assert.match(result.stdout, /ready/i);
  } finally {
    if (result.pid) {
      try {
        process.kill(-result.pid, "SIGKILL");
      } catch {
        try {
          process.kill(result.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  }
});

test("POST /act via hono", async () => {
  const app = createApp(machine(), "unit-1");
  const health = await app.request("/health");
  assert.equal(health.status, 200);
  const write = await app.request("/act", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      op: "writeFile",
      path: path.join(jail, "from-http.txt"),
      content: "ok",
    }),
  });
  assert.equal(write.status, 200);
  const read = await app.request("/act", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      op: "readFile",
      path: path.join(jail, "from-http.txt"),
    }),
  });
  const body = (await read.json()) as { content: string };
  assert.equal(body.content, "ok");
});

test("snapshot reports assigned memory and disk quotas", async () => {
  process.env.WEBMCP_MEMORY_BYTES = String(2 * 1024 ** 3);
  process.env.WEBMCP_DISK_BYTES = String(4 * 1024 ** 3);
  const s = await machine().snapshot();
  assert.equal(s.memory.total, "2GB");
  assert.equal(s.disk.total, "4GB");
  assert.match(s.memory.used, /^\d+(\.\d)?(KB|MB|GB|B)$/);
  assert.match(s.disk.used, /^\d+(\.\d)?(KB|MB|GB|B)$/);
});

test("json appearance on laptop", async () => {
  const m = machine();
  const set = await m.setWallpaper("dark-grid");
  assert.equal(set.wallpaper, "dark-grid");
  const themed = await m.setTheme("light");
  assert.equal(themed.theme, "light");
  const got = await m.appearance();
  assert.equal(got.wallpaper, "dark-grid");
  assert.equal(got.theme, "light");
});
