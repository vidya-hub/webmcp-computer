import assert from "node:assert/strict";
import { test } from "node:test";
import {
  even,
  finishMinimizeWm,
  focusWm,
  initialWm,
  maximizeWm,
  patchBoundsWm,
  reconcileWm,
  restoreWm,
  snapWm,
  startMinimizeWm,
  tile,
  type WmData,
} from "./wm.ts";

function base(over: Partial<WmData> = {}): WmData {
  return { ...initialWm, canvas: { cw: 1000, ch: 800 }, ...over };
}

test("reconcile tiles new computers and drops gone ones", () => {
  const a = reconcileWm(base(), [{ id: "a" }, { id: "b" }]);
  assert.ok(a.next.windows.a);
  assert.ok(a.next.windows.b);
  assert.equal(a.fresh.length, 0);
  assert.deepEqual(a.next.knownIds, ["a", "b"]);

  const b = reconcileWm(a.next, [{ id: "b" }, { id: "c" }]);
  assert.equal(b.next.windows.a, undefined);
  assert.ok(b.next.windows.b);
  assert.ok(b.next.windows.c);
  assert.deepEqual(b.fresh, ["c"]);
  assert.equal(b.next.lifecycle.c, "entering");
});

test("reconcile prunes maximized and minimized for missing computers", () => {
  const seeded = reconcileWm(base(), [{ id: "a" }, { id: "b" }]).next;
  const dirty: WmData = {
    ...seeded,
    maximizedId: "a",
    minimized: ["a", "b"],
  };
  const next = reconcileWm(dirty, [{ id: "b" }]).next;
  assert.equal(next.maximizedId, null);
  assert.deepEqual(next.minimized, ["b"]);
});

test("reconcile is a no-op when computer ids are unchanged", () => {
  const a = reconcileWm(base(), [{ id: "a" }, { id: "b" }]);
  const b = reconcileWm(a.next, [{ id: "a" }, { id: "b" }]);
  assert.equal(b.next, a.next);
  assert.equal(b.fresh.length, 0);
});

test("first-load computers use the same tile geometry as the helper", () => {
  const next = reconcileWm(base(), [{ id: "a" }]).next;
  assert.deepEqual(next.windows.a, tile(0, 1000, 800));
});

test("focus raises z above the previous top", () => {
  const seeded = reconcileWm(base(), [{ id: "a" }, { id: "b" }]).next;
  const focused = { ...seeded, ...focusWm(seeded, "a") };
  assert.ok(focused.windows.a);
  assert.ok(focused.windows.b);
  assert.ok(focused.windows.a.z > focused.windows.b.z);
  assert.equal(focused.zTop, focused.windows.a.z);
});

test("maximize fills the canvas and toggle restores saved bounds", () => {
  const seeded = reconcileWm(base(), [{ id: "a" }]).next;
  const before = seeded.windows.a;
  const maxed = { ...seeded, ...maximizeWm(seeded, "a") };
  assert.equal(maxed.maximizedId, "a");
  assert.equal(maxed.windows.a?.x, 8);
  assert.equal(maxed.windows.a?.y, 8);
  assert.equal(maxed.windows.a?.w, even(Math.max(320, 1000 - 16)));
  assert.equal(maxed.windows.a?.h, even(Math.max(240, 800 - 88)));

  const restored = { ...maxed, ...maximizeWm(maxed, "a") };
  assert.equal(restored.maximizedId, null);
  assert.deepEqual(restored.windows.a, before);
});

test("snap left/right halves the canvas; snap top maximizes", () => {
  const seeded = reconcileWm(base(), [{ id: "a" }]).next;
  const left = { ...seeded, ...snapWm(seeded, "a", "left") };
  assert.equal(left.windows.a?.x, 8);
  assert.equal(left.windows.a?.w, even(Math.max(320, Math.round(1000 / 2) - 12)));

  const right = { ...seeded, ...snapWm(seeded, "a", "right") };
  assert.equal(right.windows.a?.x, 1000 - (right.windows.a?.w ?? 0) - 8);

  const top = { ...seeded, ...snapWm(seeded, "a", "top") };
  assert.equal(top.maximizedId, "a");
});

test("minimize then finish adds the id; restore re-enters", () => {
  const seeded = reconcileWm(base(), [{ id: "a" }]).next;
  const starting = { ...seeded, ...startMinimizeWm(seeded, "a") };
  assert.equal(starting.lifecycle.a, "minimizing");
  const done = { ...starting, ...finishMinimizeWm(starting, "a") };
  assert.deepEqual(done.minimized, ["a"]);
  assert.equal(done.lifecycle.a, undefined);

  const restored = { ...done, ...restoreWm(done, "a") };
  assert.deepEqual(restored.minimized, []);
  assert.equal(restored.lifecycle.a, "entering");
});

test("maximize of a minimized window restores it", () => {
  const seeded = reconcileWm(base(), [{ id: "a" }]).next;
  const min = { ...seeded, minimized: ["a"] };
  const maxed = { ...min, ...maximizeWm(min, "a") };
  assert.deepEqual(maxed.minimized, []);
  assert.equal(maxed.maximizedId, "a");
});

test("patchBounds clamps to the canvas", () => {
  const seeded = reconcileWm(base(), [{ id: "a" }]).next;
  const patched = { ...seeded, ...patchBoundsWm(seeded, "a", { x: -40, w: 40 }) };
  assert.equal(patched.windows.a?.x, 0);
  assert.ok((patched.windows.a?.w ?? 0) >= 320);
});
