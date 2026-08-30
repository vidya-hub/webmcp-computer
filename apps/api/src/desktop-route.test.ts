import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyDesktop,
  FRAME_ANCESTORS,
  originAllowed,
} from "./desktop-route.ts";

const allowed = new Set(["https://app.example", "http://127.0.0.1:5173"]);

test("originAllowed: missing Origin is allowed (curl / non-browser)", () => {
  assert.equal(originAllowed(undefined, allowed), true);
  assert.equal(originAllowed(null, allowed), true);
  assert.equal(originAllowed("", allowed), true);
});

test("originAllowed: listed origin passes; foreign origin fails", () => {
  assert.equal(originAllowed("https://app.example", allowed), true);
  assert.equal(originAllowed("https://evil.example", allowed), false);
});

test("classifyDesktop: rfb leftovers", () => {
  assert.equal(classifyDesktop("/?v=rfb", true), "html-rfb");
  assert.equal(classifyDesktop("/vnc.html", true), "html-rfb");
  assert.equal(classifyDesktop("/websockify", true), "novnc");
  assert.equal(classifyDesktop("/core/rfb.js", true), "novnc");
  assert.equal(classifyDesktop("/package.json", true), "package-stub");
});

test("classifyDesktop: product stream when streamUrl exists", () => {
  assert.equal(classifyDesktop("/", true), "html-stream");
  assert.equal(classifyDesktop("/index.html", true), "html-stream");
  assert.equal(classifyDesktop("/api/websockets", true), "selkies");
  assert.equal(classifyDesktop("/api/health", true), "selkies");
  assert.equal(classifyDesktop("/selkies-core.js", true), "selkies");
});

test("classifyDesktop: without streamUrl, / stays html-rfb", () => {
  assert.equal(classifyDesktop("/", false), "html-rfb");
  assert.equal(classifyDesktop("/index.html", false), "html-rfb");
  assert.equal(classifyDesktop("/core/rfb.js", false), "novnc");
});

test("frame-ancestors token is self-only", () => {
  assert.equal(FRAME_ANCESTORS, "frame-ancestors 'self'");
});
