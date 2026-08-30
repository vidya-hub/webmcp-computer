import assert from "node:assert/strict";
import { test } from "node:test";
import { shortComputerId, tickMarks } from "./tapeTicks.ts";

test("tickMarks caps a multi-day span to a handful of labels", () => {
  const tMin = Date.parse("2026-08-28T12:15:41.750Z");
  const tMax = Date.parse("2026-08-30T10:11:27.169Z");
  const { ticks, step } = tickMarks(tMin, tMax);
  assert.ok(ticks.length <= 14, `got ${ticks.length} ticks`);
  assert.ok(step >= 3_600_000, `step ${step} should be hours, not 15s`);
});

test("tickMarks stays dense on a short span", () => {
  const tMin = Date.now();
  const { ticks, step } = tickMarks(tMin, tMin + 8000);
  assert.ok(ticks.length >= 2);
  assert.equal(step, 1000);
});

test("shortComputerId keeps the first two tokens", () => {
  assert.equal(shortComputerId("still-field-dd8"), "still-field");
  assert.equal(shortComputerId("rtest"), "rtest");
});
