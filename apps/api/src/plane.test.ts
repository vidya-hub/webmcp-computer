import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

// Force the filesystem tape/action backends into a temp dir before importing
// anything that reads TAPE_DIR / picks a storage backend at module load.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webmcp-plane-"));
process.env.TAPE_DIR = dir;
delete process.env.STORAGE_BACKEND;
delete process.env.DATABASE_URL;
delete process.env.S3_ACCESS_KEY;

let Plane: typeof import("./plane.ts").Plane;
let MemoryHost: typeof import("./memory-host.ts").MemoryHost;

// Default tenant for single-user tests.
const U = "u1";

before(async () => {
  ({ Plane } = await import("./plane.ts"));
  ({ MemoryHost } = await import("./memory-host.ts"));
});

async function seeded(user = U) {
  const plane = new Plane(new MemoryHost());
  const c = await plane.spawn(user, {}, "human");
  await plane.select(user, c.id, "human");
  return { plane, id: c.id, user };
}

function status(err: unknown): number | undefined {
  return (err as { status?: number })?.status;
}

test("act with no computer selected returns 409", async () => {
  const plane = new Plane(new MemoryHost());
  await assert.rejects(
    () => plane.act(U, { op: "snapshot" }, "agent"),
    (err) => status(err) === 409,
  );
});

test("dangerous run blocks until approved", async () => {
  const { plane } = await seeded();
  const run = plane.act(U, { op: "run", command: "rm data.txt" }, "agent");
  const ws = await plane.workspace(U);
  assert.ok(ws.pendingApproval, "expected a pending approval");
  await plane.resolveApproval(U, ws.pendingApproval!.id, "approved");
  const result = await run;
  assert.ok(result, "run resolved after approval");
});

test("rejecting a dangerous run returns a reason, not a throw", async () => {
  const { plane } = await seeded();
  const run = plane.act(U, { op: "run", command: "rm data.txt" }, "agent");
  const ws = await plane.workspace(U);
  await plane.resolveApproval(U, ws.pendingApproval!.id, "rejected");
  const result = (await run) as { reason?: string; exitCode?: number };
  assert.match(result.reason ?? "", /reject/i);
});

test("a second approval while one is pending is refused", async () => {
  const { plane } = await seeded();
  const first = plane.act(U, { op: "run", command: "rm a" }, "agent");
  await plane.workspace(U); // let the first approval register
  await assert.rejects(
    () => plane.act(U, { op: "deleteFile", path: "b" }, "agent"),
    (err) => status(err) === 409,
  );
  const ws = await plane.workspace(U);
  await plane.resolveApproval(U, ws.pendingApproval!.id, "approved");
  await first;
});

test("replaying a recipe executes its steps on the machine", async () => {
  const { plane } = await seeded();
  const action = await plane.saveRecordedAction(
    U,
    {
      name: "make-file",
      description: "writes a file",
      steps: [
        { kind: "op", op: { op: "writeFile", path: "replayed.txt", content: "hi" } },
      ],
    },
    "human",
  );
  assert.ok("id" in action, "recipe saved");
  const res = (await plane.replayRecordedAction(
    U,
    { actionId: (action as { id: string }).id },
    1,
    "agent",
  )) as { ran?: number };
  assert.equal(res.ran, 1);
});

test("raw replayAction with a dangerous nested run is gated", async () => {
  const { plane } = await seeded();
  const run = plane.act(
    U,
    {
      op: "replayAction",
      steps: [{ kind: "op", op: { op: "run", command: "rm -rf ~" } }],
    },
    "agent",
  );
  const ws = await plane.workspace(U);
  assert.ok(ws.pendingApproval, "raw replayAction must prompt for approval");
  await plane.resolveApproval(U, ws.pendingApproval!.id, "rejected");
  const res = (await run) as { success?: boolean };
  assert.equal(res.success, false);
});

test("replayAction with only safe steps runs without approval", async () => {
  const { plane } = await seeded();
  const res = (await plane.act(
    U,
    {
      op: "replayAction",
      steps: [
        { kind: "op", op: { op: "writeFile", path: "safe.txt", content: "ok" } },
      ],
    },
    "agent",
  )) as { ran?: number };
  assert.equal(res.ran, 1);
});

test("record start/event/stop builds a recorded action with the input step", async () => {
  const { plane } = await seeded();
  await plane.recordStart(U);
  await plane.recordEvent(U, { kind: "type", text: "hello" } as never);
  await plane.recordEvent(U, { kind: "click", x: 10, y: 20 } as never);
  const action = await plane.recordStop(U, "demo", "");
  assert.equal(action.source, "recorded");
  assert.equal(action.steps.length, 2);
  assert.equal(action.steps[0]!.kind, "type");
  assert.ok(typeof action.steps[0]!.t === "number");
});

test("agent replay of a recorded type step prompts; human replay does not", async () => {
  const { plane } = await seeded();
  const steps = [{ kind: "type", text: "rm -rf ~" }] as never;
  const agent = plane.act(U, { op: "replayAction", steps }, "agent");
  const ws = await plane.workspace(U);
  assert.ok(ws.pendingApproval, "agent replay of typed input must prompt");
  assert.match(ws.pendingApproval!.body, /rm -rf ~/);
  await plane.resolveApproval(U, ws.pendingApproval!.id, "approved");
  await agent;
  const res = (await plane.act(U, { op: "replayAction", steps }, "human")) as {
    ran?: number;
  };
  assert.equal(res.ran, 1);
});

test("selecting another computer does not discard the recording", async () => {
  const { plane, id } = await seeded();
  const other = await plane.spawn(U, {}, "human");
  await plane.recordStart(U);
  await plane.recordEvent(U, { kind: "type", text: "keep" });
  await plane.select(U, other.id, "human");
  const st = await plane.recordStatus(U);
  assert.equal(st.recording, true);
  assert.equal(st.computerId, id);
  const ws = await plane.workspace(U);
  assert.equal(ws.recordingComputerId, id);
  assert.equal(ws.selectedComputer, other.id);
  const action = await plane.recordStop(U, "kept", "");
  assert.equal(action.steps.length, 1);
  assert.equal(action.steps[0]!.kind, "type");
});

test("agent ops on a different computer do not join the recording", async () => {
  const { plane, id } = await seeded();
  const other = await plane.spawn(U, {}, "human");
  await plane.recordStart(U);
  await plane.act(U, { op: "writeFile", path: "on-a.txt", content: "a" }, "human");
  await plane.select(U, other.id, "human");
  await plane.act(U, { op: "writeFile", path: "on-b.txt", content: "b" }, "human");
  const action = await plane.recordStop(U, "only-a", "");
  assert.equal(action.computerId, id);
  assert.equal(action.steps.length, 1);
  assert.equal(action.steps[0]!.kind, "op");
});

test("client t and computerId are ignored; the API stamps t", async () => {
  const { plane } = await seeded();
  await plane.recordStart(U);
  await plane.recordEvent(U, {
    kind: "type",
    text: "hi",
    t: 99999,
    computerId: "forged",
  });
  const action = await plane.recordStop(U, "stamp", "");
  const step = action.steps[0]!;
  assert.equal(step.kind, "type");
  assert.ok(typeof step.t === "number" && step.t < 5_000);
  assert.equal("computerId" in step, false);
});

test("an agent cannot start, append, or stop a recording", async () => {
  const { plane } = await seeded();
  await assert.rejects(
    () => plane.recordStart(U, "agent"),
    (err: unknown) => status(err) === 403,
  );
  await plane.recordStart(U, "human");
  await assert.rejects(
    () => plane.recordEvent(U, { kind: "type", text: "x" }, "agent"),
    (err: unknown) => status(err) === 403,
  );
  await plane.recordEvent(U, { kind: "type", text: "ok" }, "human");
  await assert.rejects(
    () => plane.recordStop(U, "nope", "", "agent"),
    (err) => status(err) === 403,
  );
  const action = await plane.recordStop(U, "ok", "", "human");
  assert.equal(action.steps.length, 1);
  assert.equal(action.steps[0]!.kind, "type");
});

test("recordEvent rejects unknown kinds and extra client fields stay dropped", async () => {
  const { plane } = await seeded();
  await plane.recordStart(U);
  await assert.rejects(
    () => plane.recordEvent(U, { kind: "op", op: { op: "snapshot" } }),
    (err: unknown) => status(err) === 400,
  );
  await assert.rejects(
    () => plane.recordEvent(U, { kind: "type" }),
    (err: unknown) => status(err) === 400,
  );
  await plane.discardRecording(U);
});

test("destroying the recording computer discards; destroying another does not", async () => {
  const { plane, id } = await seeded();
  const other = await plane.spawn(U, {}, "human");
  await plane.recordStart(U);
  await plane.recordEvent(U, { kind: "type", text: "keep" });

  const dropOther = plane.destroy(U, other.id, "human");
  const wsOther = await plane.workspace(U);
  assert.ok(wsOther.pendingApproval);
  await plane.resolveApproval(U, wsOther.pendingApproval!.id, "approved");
  await dropOther;
  assert.equal((await plane.recordStatus(U)).recording, true);
  assert.equal((await plane.recordStatus(U)).computerId, id);

  const dropRec = plane.destroy(U, id, "human");
  const wsRec = await plane.workspace(U);
  assert.ok(wsRec.pendingApproval);
  await plane.resolveApproval(U, wsRec.pendingApproval!.id, "approved");
  await dropRec;
  assert.equal((await plane.recordStatus(U)).recording, false);
});

test("human replay of a recorded gated run does not prompt", async () => {
  const { plane } = await seeded();
  const wsBefore = await plane.workspace(U);
  assert.equal(wsBefore.pendingApproval, null);
  const res = (await plane.act(
    U,
    {
      op: "replayAction",
      steps: [{ kind: "op", op: { op: "run", command: "rm -rf x" } }],
    },
    "human",
  )) as { ran?: number };
  const wsAfter = await plane.workspace(U);
  assert.equal(wsAfter.pendingApproval, null);
  assert.equal(res.ran, 1);
});

test("MemoryHost replays input kinds by t with no geometry check", async () => {
  const { plane } = await seeded();
  const res = (await plane.act(
    U,
    {
      op: "replayAction",
      steps: [
        { kind: "click", x: 10, y: 20, t: 0 },
        { kind: "type", text: "hi", t: 2 },
        { kind: "key", keys: "Return", t: 4 },
      ],
    },
    "human",
  )) as { ran?: number };
  assert.equal(res.ran, 3);
});

test("spawn returns a public Computer with no stream secrets", async () => {
  const plane = new Plane(new MemoryHost());
  const c = await plane.spawn(U, {}, "human");
  assert.equal("streamAuth" in c, false);
  assert.equal("streamUrl" in c, false);
  assert.equal("vncUrl" in c, false);
  assert.equal("ownerId" in c, false);
  assert.equal(c.status, "running");
});

test("saving a recipe with a gated op requires approval (even for a human)", async () => {
  const { plane } = await seeded();
  // Privileged ops are gated on save regardless of actor — a stored `run: rm`
  // is a stored exploit.
  const save = plane.saveRecordedAction(
    U,
    {
      name: "danger",
      steps: [{ kind: "op", op: { op: "run", command: "rm -rf x" } }],
    },
    "human",
  );
  const ws = await plane.workspace(U);
  assert.ok(ws.pendingApproval, "gated save prompts for approval");
  await plane.resolveApproval(U, ws.pendingApproval!.id, "rejected");
  const result = (await save) as { rejected?: boolean };
  assert.equal(result.rejected, true);
});

// --- Multi-tenancy ---------------------------------------------------------

test("one user cannot see, select, act on, or destroy another's computer", async () => {
  const plane = new Plane(new MemoryHost());
  const a = await plane.spawn("alice", {}, "human");
  await plane.spawn("bob", {}, "human");

  // Bob's list never contains Alice's computer.
  const bobList = await plane.listComputers("bob");
  assert.equal(bobList.some((c) => c.id === a.id), false);
  // Alice's list contains her own.
  const aliceList = await plane.listComputers("alice");
  assert.equal(aliceList.some((c) => c.id === a.id), true);

  // Bob selecting Alice's id → 404.
  await assert.rejects(
    () => plane.select("bob", a.id, "human"),
    (err) => status(err) === 404,
  );
  // Bob destroying Alice's id → 404.
  await assert.rejects(
    () => plane.destroy("bob", a.id, "human"),
    (err) => status(err) === 404,
  );
});

test("selection and recording are isolated per user", async () => {
  const plane = new Plane(new MemoryHost());
  const a = await plane.spawn("alice", {}, "human");
  const b = await plane.spawn("bob", {}, "human");
  await plane.select("alice", a.id, "human");
  await plane.select("bob", b.id, "human");
  assert.equal((await plane.workspace("alice")).selectedComputer, a.id);
  assert.equal((await plane.workspace("bob")).selectedComputer, b.id);

  await plane.recordStart("alice");
  assert.equal((await plane.recordStatus("alice")).recording, true);
  assert.equal((await plane.recordStatus("bob")).recording, false);
  await plane.discardRecording("alice");
});

test("per-user quota: the 5th computer for a user is 429", async () => {
  const plane = new Plane(new MemoryHost());
  for (let i = 0; i < 4; i++) await plane.spawn("alice", {}, "human");
  await assert.rejects(
    () => plane.spawn("alice", {}, "human"),
    (err) => status(err) === 429,
  );
  // A different user is unaffected.
  const b = await plane.spawn("bob", {}, "human");
  assert.ok(b.id);
});
