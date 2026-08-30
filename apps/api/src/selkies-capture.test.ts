import assert from "node:assert/strict";
import { test } from "node:test";
import { injectSelkiesCapture, selkiesCaptureScript } from "./selkies-capture.ts";

test("capture script is observe-only postMessage with origin check", () => {
  const src = selkiesCaptureScript();
  assert.match(src, /ev\.origin!==location\.origin/);
  assert.match(src, /type:"record-step"/);
  assert.match(src, /type:"record-flushed"/);
  assert.match(src, /setTimeout\(flushType,400\)/);
  assert.match(src, /d\.type==="record"/);
  assert.match(src, /d\.type==="replay"/);
  assert.match(src, /videoWidth/);
  assert.doesNotMatch(src, /preventDefault/);
});

test("injectSelkiesCapture inserts before </body>", () => {
  const html = injectSelkiesCapture("<html><body><video></video></body></html>");
  assert.match(html, /__webmcpRecord/);
  assert.ok(html.indexOf("__webmcpRecord") < html.indexOf("</body>"));
});

test("takeover overlay is injected for the Selkies primary-client kill", () => {
  const html = injectSelkiesCapture("<html><body></body></html>");
  assert.match(html, /__webmcpTakeover/);
  assert.match(html, /Use this tab/);
  assert.match(html, /new primary client/);
});

test("fps reporter is injected and posts origin-checked telemetry", () => {
  const html = injectSelkiesCapture("<html><body></body></html>");
  assert.match(html, /__webmcpFps/);
  assert.match(html, /type:"fps"/);
  assert.match(html, /requestVideoFrameCallback/);
  assert.match(html, /getVideoPlaybackQuality/);
});
