// Parent-side record controller. The noVNC iframe captures human input and
// postMessages normalized steps here; we POST them to /api/record/event on a
// single sequential queue, and on stop we flush the iframe, drain the queue,
// then POST /api/record/stop. Agent actions are captured server-side in act().
import { api } from "../../api/client.ts";
import { store } from "../../store/index.ts";

let activeId: string | null = null;
let queue: Promise<void> = Promise.resolve();
let onMessage: ((e: MessageEvent) => void) | null = null;
let flushedResolve: (() => void) | null = null;
let unsub: (() => void) | null = null;

function iframeFor(id: string): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>(
    `iframe[title="${CSS.escape(id)}"]`,
  );
}

function toIframe(id: string, on: boolean): void {
  iframeFor(id)?.contentWindow?.postMessage(
    { source: "webmcp", type: "record", on },
    location.origin,
  );
}

export function setReplayLock(id: string, on: boolean): void {
  iframeFor(id)?.contentWindow?.postMessage(
    { source: "webmcp", type: "replay", on },
    location.origin,
  );
}

function enqueueEvent(step: unknown): void {
  queue = queue.then(() =>
    api(
      "/api/record/event",
      { method: "POST", body: JSON.stringify(step) },
    ).then(
      () => undefined,
      () => undefined,
    ),
  );
}

function cleanup(): void {
  if (onMessage) window.removeEventListener("message", onMessage);
  onMessage = null;
  flushedResolve = null;
  if (unsub) unsub();
  unsub = null;
  activeId = null;
}

// Server ended the recording on its own (cap hit, computer destroyed): stop the
// iframe capturing and tear down, without calling /api/record/stop.
function hardStop(): void {
  if (activeId) toIframe(activeId, false);
  cleanup();
}

export async function startRecording(computerId: string): Promise<void> {
  if (activeId) return;
  if (store.getState().selectedComputer !== computerId) {
    await store.getState().selectComputer(computerId);
  }
  await api("/api/record/start", {
    method: "POST",
    body: "{}",
  });
  activeId = computerId;
  store.getState().setRecordingComputerId(computerId);

  onMessage = (e: MessageEvent) => {
    if (e.origin !== location.origin) return;
    const d = e.data as { source?: string; type?: string; step?: unknown };
    if (!d || d.source !== "webmcp") return;
    if (d.type === "record-step") enqueueEvent(d.step);
    else if (d.type === "record-flushed" && flushedResolve) {
      flushedResolve();
      flushedResolve = null;
    }
  };
  window.addEventListener("message", onMessage);

  // If the server clears the recording out from under us (cap/destroy via WS),
  // stop the iframe and tear down.
  unsub = store.subscribe((s) => {
    if (activeId && s.recordingComputerId !== activeId) hardStop();
  });

  toIframe(computerId, true);
}

export async function stopRecording(
  name: string,
  description: string,
): Promise<void> {
  const id = activeId;
  if (!id) return;
  // Flush the iframe's pending type buffer, wait for its ack (or a short cap).
  const flushed = new Promise<void>((res) => {
    flushedResolve = res;
  });
  toIframe(id, false);
  await Promise.race([flushed, new Promise((r) => setTimeout(r, 600))]);
  await queue; // drain queued record/event POSTs before stopping
  try {
    await api("/api/record/stop", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
  } finally {
    cleanup();
    store.getState().setRecordingComputerId(null);
  }
}
