import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityEvent } from "@webmcp-computer/contract";
import {
  ACTIVITY_CAP,
  MemoryWorkspace,
  RECORD_TTL_MS,
  RedisWorkspace,
  type WorkspaceStore,
} from "./workspace-store.ts";

// Minimal in-memory Redis implementing just the commands RedisWorkspace uses,
// so the Redis backend is exercised without a live server.
class FakeRedis {
  private hashes = new Map<string, Map<string, string>>();
  private lists = new Map<string, string[]>();
  private hash(k: string) {
    let h = this.hashes.get(k);
    if (!h) this.hashes.set(k, (h = new Map()));
    return h;
  }
  async hget(k: string, field: string) {
    return this.hash(k).get(field) ?? null;
  }
  async hset(k: string, field: string, value: string) {
    this.hash(k).set(field, value);
    return 1;
  }
  async hdel(k: string, ...fields: string[]) {
    const h = this.hash(k);
    let n = 0;
    for (const f of fields) if (h.delete(f)) n++;
    return n;
  }
  async del(...keys: string[]) {
    for (const k of keys) {
      this.hashes.delete(k);
      this.lists.delete(k);
    }
  }
  private list(k: string) {
    let l = this.lists.get(k);
    if (!l) this.lists.set(k, (l = []));
    return l;
  }
  async lpush(k: string, v: string) {
    const l = this.list(k);
    l.unshift(v);
    return l.length;
  }
  async rpush(k: string, v: string) {
    const l = this.list(k);
    l.push(v);
    return l.length;
  }
  async ltrim(k: string, start: number, stop: number) {
    const l = this.list(k);
    this.lists.set(k, l.slice(start, stop + 1));
  }
  async lrange(k: string, start: number, stop: number) {
    const l = this.list(k);
    return l.slice(start, stop === -1 ? undefined : stop + 1);
  }
  async llen(k: string) {
    return this.list(k).length;
  }
  async pexpire() {
    /* TTL is a no-op in the fake */
  }
}

function activity(verb: string): ActivityEvent {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor: "human",
    computerId: "c1" as never,
    verb,
    detail: "",
  };
}

function suite(name: string, make: () => WorkspaceStore) {
  test(`${name}: selection is per-user`, async () => {
    const ws = make();
    await ws.setSelected("alice", "c1" as never);
    await ws.setSelected("bob", "c2" as never);
    assert.equal(await ws.getSelected("alice"), "c1");
    assert.equal(await ws.getSelected("bob"), "c2");
    assert.equal(await ws.getSelected("carol"), null);
  });

  test(`${name}: activity is capped and per-user`, async () => {
    const ws = make();
    for (let i = 0; i < ACTIVITY_CAP + 10; i++) {
      await ws.pushActivity("alice", activity(`a${i}`));
    }
    const a = await ws.getActivity("alice");
    assert.equal(a.length, ACTIVITY_CAP);
    assert.equal(a[0]!.verb, `a${ACTIVITY_CAP + 9}`); // newest first
    assert.equal((await ws.getActivity("bob")).length, 0);
  });

  test(`${name}: recording lifecycle isolates users`, async () => {
    const ws = make();
    await ws.startRecording("alice", "c1" as never, Date.now());
    await ws.appendStep("alice", { kind: "type", text: "hi", t: 5 });
    const n = await ws.appendStep("alice", { kind: "click", x: 1, y: 2, t: 9 });
    assert.equal(n, 2);
    assert.equal((await ws.getRecording("alice"))?.computerId, "c1");
    assert.equal(await ws.getRecording("bob"), null);
    const steps = await ws.getSteps("alice");
    assert.equal(steps.length, 2);
    assert.equal(steps[0]!.kind, "type");
    await ws.clearRecording("alice");
    assert.equal(await ws.getRecording("alice"), null);
    assert.equal((await ws.getSteps("alice")).length, 0);
  });

  test(`${name}: approval + lastChoice round-trip`, async () => {
    const ws = make();
    assert.equal(await ws.getApproval("alice"), null);
    await ws.setApproval("alice", {
      id: "ap1",
      computerId: "c1" as never,
      tool: "t",
      summary: "s",
      title: "T",
      body: "B",
      status: "pending",
    });
    assert.equal((await ws.getApproval("alice"))?.id, "ap1");
    await ws.setLastChoice("alice", "Destroy");
    assert.equal(await ws.getLastChoice("alice"), "Destroy");
    await ws.setApproval("alice", null);
    assert.equal(await ws.getApproval("alice"), null);
  });
}

suite("MemoryWorkspace", () => new MemoryWorkspace());
suite("RedisWorkspace", () => new RedisWorkspace(new FakeRedis()));

test("RedisWorkspace: recording meta older than the TTL reads as idle", async () => {
  const ws = new RedisWorkspace(new FakeRedis());
  // Start with a t0 well past the 10-minute cap (steps list would have expired,
  // but the hash field has no TTL).
  await ws.startRecording("alice", "c1" as never, Date.now() - RECORD_TTL_MS - 1000);
  assert.equal(await ws.getRecording("alice"), null);
});
