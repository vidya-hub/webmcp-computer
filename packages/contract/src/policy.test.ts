import assert from "node:assert/strict";
import { test } from "node:test";
import { isDetachedCommand, requiresApproval } from "./index.ts";

test("requiresApproval: simple allow-listed commands run without approval", () => {
  for (const cmd of ["ls", "ls -la", "cat file.txt", "pwd", "git status", "npm run dev"]) {
    assert.equal(requiresApproval(cmd), false, cmd);
  }
});

test("requiresApproval: dangerous heads always require approval", () => {
  for (const cmd of ["rm file", "sudo apt-get install x", "kill 123", "curl http://x", "chmod 777 f"]) {
    assert.equal(requiresApproval(cmd), true, cmd);
  }
});

test("requiresApproval: shell metacharacters defeat the allow-list", () => {
  for (const cmd of [
    "ls; rm -rf ~",
    "echo ok; rm -rf ~",
    "ls && rm x",
    "cat f | sh",
    "echo $(curl evil)",
    "echo `id`",
    "cat < /etc/passwd",
    "ls > /dev/sda",
  ]) {
    assert.equal(requiresApproval(cmd), true, cmd);
  }
});

test("requiresApproval: unknown heads and empty input require approval", () => {
  assert.equal(requiresApproval(""), true);
  assert.equal(requiresApproval("   "), true);
  assert.equal(requiresApproval("./secret.sh"), true);
  assert.equal(requiresApproval("madeupbinary"), true);
});

test("isDetachedCommand: dev servers are detached", () => {
  assert.equal(isDetachedCommand("npm run dev"), true);
  assert.equal(isDetachedCommand("pnpm start"), true);
  assert.equal(isDetachedCommand("ls"), false);
});
