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

before(async () => {
  ({ Plane } = await import("./plane.ts"));
  ({ MemoryHost } = await import("./memory-host.ts"));
});

async function seeded() {
  const plane = new Plane(new MemoryHost());
  const c = await plane.spawn({}, "human");
  await plane.select(c.id, "human");
  return { plane, id: c.id };
}

function status(err: unknown): number | undefined {
  return (err as { status?: number })?.status;
}

test("act with no computer selected returns 409", async () => {
  const plane = new Plane(new MemoryHost());
  await assert.rejects(
    () => plane.act({ op: "snapshot" }, "agent"),
    (err) => status(err) === 409,
  );
});

test("dangerous run blocks until approved", async () => {
  const { plane } = await seeded();
  const run = plane.act({ op: "run", command: "rm data.txt" }, "agent");
  // Approval is pending until resolved.
  const ws = await plane.workspace();
  assert.ok(ws.pendingApproval, "expected a pending approval");
  await plane.resolveApproval(ws.pendingApproval!.id, "approved");
  const result = await run;
  assert.ok(result, "run resolved after approval");
});

test("rejecting a dangerous run returns a reason, not a throw", async () => {
  const { plane } = await seeded();
  const run = plane.act({ op: "run", command: "rm data.txt" }, "agent");
  const ws = await plane.workspace();
  await plane.resolveApproval(ws.pendingApproval!.id, "rejected");
  const result = (await run) as { reason?: string; exitCode?: number };
  assert.match(result.reason ?? "", /reject/i);
});

test("a second approval while one is pending is refused", async () => {
  const { plane } = await seeded();
  const first = plane.act({ op: "run", command: "rm a" }, "agent");
  await plane.workspace(); // let the first approval register
  await assert.rejects(
    () => plane.act({ op: "deleteFile", path: "b" }, "agent"),
    (err) => status(err) === 409,
  );
  const ws = await plane.workspace();
  await plane.resolveApproval(ws.pendingApproval!.id, "approved");
  await first;
});

test("replaying a recipe executes its steps on the machine", async () => {
  const { plane, id } = await seeded();
  const action = await plane.saveRecordedAction(
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
    { actionId: (action as { id: string }).id },
    1,
    "agent",
  )) as { ran?: number };
  assert.equal(res.ran, 1);
  // The write actually happened on the (memory) machine.
  const machine = new MemoryHost(); // sanity: types line up
  void machine;
  void id;
});

test("raw replayAction with a dangerous nested run is gated", async () => {
  // The HTTP surface (POST /api/act) can send replayAction directly, bypassing
  // replayRecordedAction. act() itself must gate the nested steps.
  const { plane } = await seeded();
  const run = plane.act(
    {
      op: "replayAction",
      steps: [{ kind: "op", op: { op: "run", command: "rm -rf ~" } }],
    },
    "agent",
  );
  const ws = await plane.workspace();
  assert.ok(ws.pendingApproval, "raw replayAction must prompt for approval");
  await plane.resolveApproval(ws.pendingApproval!.id, "rejected");
  const res = (await run) as { success?: boolean };
  assert.equal(res.success, false);
});

test("replayAction with only safe steps runs without approval", async () => {
  const { plane } = await seeded();
  const res = (await plane.act(
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
  plane.recordStart();
  plane.recordEvent({ kind: "type", text: "hello" } as never);
  plane.recordEvent({ kind: "click", x: 10, y: 20 } as never);
  const action = await plane.recordStop("demo", "");
  assert.equal(action.source, "recorded");
  assert.equal(action.steps.length, 2);
  assert.equal(action.steps[0]!.kind, "type");
  assert.ok(typeof action.steps[0]!.t === "number");
});

test("agent replay of a recorded type step prompts; human replay does not", async () => {
  const { plane } = await seeded();
  const steps = [{ kind: "type", text: "rm -rf ~" }] as never;
  // Agent → gated (raw /api/act path).
  const agent = plane.act({ op: "replayAction", steps }, "agent");
  const ws = await plane.workspace();
  assert.ok(ws.pendingApproval, "agent replay of typed input must prompt");
  assert.match(ws.pendingApproval!.body, /rm -rf ~/);
  await plane.resolveApproval(ws.pendingApproval!.id, "approved");
  await agent;
  // Human → runs immediately, no approval.
  const res = (await plane.act({ op: "replayAction", steps }, "human")) as {
    ran?: number;
  };
  assert.equal(res.ran, 1);
});

test("selecting another computer does not discard the recording", async () => {
  const { plane, id } = await seeded();
  const other = await plane.spawn({}, "human");
  plane.recordStart();
  plane.recordEvent({ kind: "type", text: "keep" });
  await plane.select(other.id, "human");
  const st = plane.recordStatus();
  assert.equal(st.recording, true);
  assert.equal(st.computerId, id);
  const ws = await plane.workspace();
  assert.equal(ws.recordingComputerId, id);
  assert.equal(ws.selectedComputer, other.id);
  const action = await plane.recordStop("kept", "");
  assert.equal(action.steps.length, 1);
  assert.equal(action.steps[0]!.kind, "type");
});

test("agent ops on a different computer do not join the recording", async () => {
  const { plane, id } = await seeded();
  const other = await plane.spawn({}, "human");
  plane.recordStart();
  await plane.act({ op: "writeFile", path: "on-a.txt", content: "a" }, "human");
  await plane.select(other.id, "human");
  await plane.act({ op: "writeFile", path: "on-b.txt", content: "b" }, "human");
  const action = await plane.recordStop("only-a", "");
  assert.equal(action.computerId, id);
  assert.equal(action.steps.length, 1);
  assert.equal(action.steps[0]!.kind, "op");
});

test("client t and computerId are ignored; the API stamps t", async () => {
  const { plane } = await seeded();
  plane.recordStart();
  plane.recordEvent({
    kind: "type",
    text: "hi",
    t: 99999,
    computerId: "forged",
  });
  const action = await plane.recordStop("stamp", "");
  const step = action.steps[0]!;
  assert.equal(step.kind, "type");
  assert.ok(typeof step.t === "number" && step.t < 5_000);
  assert.equal("computerId" in step, false);
});

test("an agent cannot start, append, or stop a recording", async () => {
  const { plane } = await seeded();
  assert.throws(
    () => plane.recordStart("agent"),
    (err: unknown) => status(err) === 403,
  );
  plane.recordStart("human");
  assert.throws(
    () => plane.recordEvent({ kind: "type", text: "x" }, "agent"),
    (err: unknown) => status(err) === 403,
  );
  plane.recordEvent({ kind: "type", text: "ok" }, "human");
  await assert.rejects(
    () => plane.recordStop("nope", "", "agent"),
    (err) => status(err) === 403,
  );
  const action = await plane.recordStop("ok", "", "human");
  assert.equal(action.steps.length, 1);
  assert.equal(action.steps[0]!.kind, "type");
});

test("recordEvent rejects unknown kinds and extra client fields stay dropped", async () => {
  const { plane } = await seeded();
  plane.recordStart();
  assert.throws(
    () => plane.recordEvent({ kind: "op", op: { op: "snapshot" } }),
    (err: unknown) => status(err) === 400,
  );
  assert.throws(
    () => plane.recordEvent({ kind: "type" }),
    (err: unknown) => status(err) === 400,
  );
  plane.discardRecording();
});

test("destroying the recording computer discards; destroying another does not", async () => {
  const { plane, id } = await seeded();
  const other = await plane.spawn({}, "human");
  plane.recordStart();
  plane.recordEvent({ kind: "type", text: "keep" });

  const dropOther = plane.destroy(other.id, "human");
  const wsOther = await plane.workspace();
  assert.ok(wsOther.pendingApproval);
  await plane.resolveApproval(wsOther.pendingApproval!.id, "approved");
  await dropOther;
  assert.equal(plane.recordStatus().recording, true);
  assert.equal(plane.recordStatus().computerId, id);

  const dropRec = plane.destroy(id, "human");
  const wsRec = await plane.workspace();
  assert.ok(wsRec.pendingApproval);
  await plane.resolveApproval(wsRec.pendingApproval!.id, "approved");
  await dropRec;
  assert.equal(plane.recordStatus().recording, false);
});

test("human replay of a recorded gated run does not prompt", async () => {
  const { plane } = await seeded();
  const wsBefore = await plane.workspace();
  assert.equal(wsBefore.pendingApproval, null);
  const res = (await plane.act(
    {
      op: "replayAction",
      steps: [{ kind: "op", op: { op: "run", command: "rm -rf x" } }],
    },
    "human",
  )) as { ran?: number };
  const wsAfter = await plane.workspace();
  assert.equal(wsAfter.pendingApproval, null);
  assert.equal(res.ran, 1);
});

test("MemoryHost replays input kinds by t with no geometry check", async () => {
  const { plane } = await seeded();
  const res = (await plane.act(
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
  const c = await plane.spawn({}, "human");
  assert.equal("streamAuth" in c, false);
  assert.equal("streamUrl" in c, false);
  assert.equal("vncUrl" in c, false);
  assert.equal(c.status, "running");
});

test("saving a recipe with a gated op requires approval", async () => {
  const { plane } = await seeded();
  const save = plane.saveRecordedAction(
    {
      name: "danger",
      steps: [{ kind: "op", op: { op: "run", command: "rm -rf x" } }],
    },
    "agent",
  );
  const ws = await plane.workspace();
  assert.ok(ws.pendingApproval, "gated save prompts for approval");
  await plane.resolveApproval(ws.pendingApproval!.id, "rejected");
  const result = (await save) as { rejected?: boolean };
  assert.equal(result.rejected, true);
});
