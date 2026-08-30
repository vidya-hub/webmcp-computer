import assert from "node:assert/strict";
import { test } from "node:test";
import { fpsTone } from "./streamFps.ts";

test("fpsTone bands around the 24 fps encode target", () => {
  assert.equal(fpsTone(24), "ok");
  assert.equal(fpsTone(20), "ok");
  assert.equal(fpsTone(19), "mid");
  assert.equal(fpsTone(10), "mid");
  assert.equal(fpsTone(9), "low");
  assert.equal(fpsTone(0), "low");
});
