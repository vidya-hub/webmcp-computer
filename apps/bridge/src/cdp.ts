import { spawn } from "node:child_process";
import {
  type BrowserState,
  type BrowserTab,
} from "@webmcp-computer/contract";
import { HttpError } from "./http-error.ts";

function cdpBase(): string {
  return (process.env.CDP_URL ?? "http://127.0.0.1:9222").replace(/\/$/, "");
}

type CdpTarget = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

async function listTargets(): Promise<CdpTarget[] | null> {
  try {
    const res = await fetch(`${cdpBase()}/json/list`);
    if (!res.ok) return null;
    return (await res.json()) as CdpTarget[];
  } catch {
    return null;
  }
}

export async function cdpAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${cdpBase()}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

function pageTargets(targets: CdpTarget[]): CdpTarget[] {
  const pages = targets.filter(
    (t) =>
      t.type === "page" &&
      !t.url.startsWith("devtools://") &&
      !t.url.startsWith("chrome://") &&
      t.url !== "about:blank",
  );
  if (pages.length > 0) return pages;
  return targets.filter(
    (t) => t.type === "page" && !t.url.startsWith("devtools://"),
  );
}

export async function browserState(): Promise<BrowserState> {
  const targets = await listTargets();
  if (!targets) return { activeTab: null, tabs: [] };
  const pages = pageTargets(targets);
  const tabs: BrowserTab[] = pages.map((p) => ({
    id: p.id,
    title: p.title || p.url,
    url: p.url,
  }));
  return { activeTab: tabs[0] ?? null, tabs };
}

let launching: Promise<void> | null = null;

async function ensureBrowser(): Promise<void> {
  if (await cdpAlive()) return;
  if (!launching) {
    launching = (async () => {
      spawn("chromium", ["about:blank"], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":1" },
      }).unref();
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (await cdpAlive()) return;
        await new Promise((r) => setTimeout(r, 300));
      }
      throw new HttpError(502, { error: "browser not running" });
    })().finally(() => {
      launching = null;
    });
  }
  await launching;
}

async function activePage(): Promise<CdpTarget> {
  await ensureBrowser();
  const targets = await listTargets();
  if (!targets) throw new HttpError(502, { error: "browser not running" });
  const page = pageTargets(targets).find((t) => t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) {
    throw new HttpError(502, { error: "browser not running" });
  }
  return page;
}

function cdpSend(
  wsUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 8000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new HttpError(502, { error: "cdp timed out" }))),
      timeoutMs,
    );
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (msg.id !== 1) return;
        finish(() => {
          if (msg.error) {
            reject(new HttpError(502, { error: msg.error.message ?? "cdp error" }));
          } else {
            resolve(msg.result);
          }
        });
      } catch {
        /* */
      }
    });
    ws.addEventListener("error", () => {
      finish(() => reject(new HttpError(502, { error: "browser not running" })));
    });
  });
}

export async function navigate(url: string): Promise<BrowserState> {
  const page = await activePage();
  await pageNavigate(page.webSocketDebuggerUrl!, url, page.id);
  return browserState();
}

export async function createTab(url: string): Promise<BrowserState> {
  await ensureBrowser();
  const res = await fetch(
    `${cdpBase()}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  if (!res.ok) throw new HttpError(502, { error: "could not create tab" });
  return browserState();
}

export async function selectTab(tabId: string): Promise<BrowserState> {
  await ensureBrowser();
  const res = await fetch(`${cdpBase()}/json/activate/${encodeURIComponent(tabId)}`);
  if (!res.ok) throw new HttpError(404, { error: "unknown tab" });
  return browserState();
}

export async function closeTab(tabId: string): Promise<BrowserState> {
  await ensureBrowser();
  const res = await fetch(`${cdpBase()}/json/close/${encodeURIComponent(tabId)}`);
  if (!res.ok) throw new HttpError(404, { error: "unknown tab" });
  return browserState();
}

export async function reloadTab(): Promise<BrowserState> {
  const page = await activePage();
  await cdpSend(page.webSocketDebuggerUrl!, "Page.reload", {});
  return browserState();
}

export async function visibleText(): Promise<{ text: string }> {
  const page = await activePage();
  const result = (await cdpSend(page.webSocketDebuggerUrl!, "Runtime.evaluate", {
    expression: "document.body ? document.body.innerText : ''",
    returnByValue: true,
  })) as { result?: { value?: string } };
  return { text: String(result.result?.value ?? "") };
}

export async function findText(
  query: string,
): Promise<{ query: string; count: number; snippets: string[] }> {
  const { text } = await visibleText();
  const q = query.toLowerCase();
  const lines = text.split(/\n/).filter((l) => l.toLowerCase().includes(q));
  return {
    query,
    count: lines.length,
    snippets: lines.slice(0, 20).map((l) => l.trim().slice(0, 200)),
  };
}

export async function clickSelector(
  selector: string,
): Promise<{ ok: true }> {
  const page = await activePage();
  const result = (await cdpSend(page.webSocketDebuggerUrl!, "Runtime.evaluate", {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
    returnByValue: true,
  })) as { result?: { value?: boolean } };
  if (!result.result?.value) {
    throw new HttpError(404, { error: "selector not found" });
  }
  return { ok: true };
}

export async function capturePage(
  fullPage = true,
): Promise<{ mimeType: "image/png"; data: string; path: string }> {
  const page = await activePage();
  const ws = page.webSocketDebuggerUrl!;
  const params: Record<string, unknown> = {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: fullPage,
  };
  if (fullPage) {
    const dim = (await cdpSend(ws, "Runtime.evaluate", {
      expression:
        "({w:Math.max(document.documentElement.scrollWidth,document.body&&document.body.scrollWidth||0),h:Math.max(document.documentElement.scrollHeight,document.body&&document.body.scrollHeight||0)})",
      returnByValue: true,
    })) as { result?: { value?: { w?: number; h?: number } } };
    const w = Math.min(16384, Math.max(1, Number(dim.result?.value?.w ?? 1)));
    const h = Math.min(16384, Math.max(1, Number(dim.result?.value?.h ?? 1)));
    params.clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
  }
  const shot = (await cdpSend(
    ws,
    "Page.captureScreenshot",
    params,
    20_000,
  )) as { data?: string };
  if (!shot.data) throw new HttpError(502, { error: "screenshot failed" });
  return { mimeType: "image/png", data: shot.data, path: "" };
}

function pageNavigate(
  wsUrl: string,
  url: string,
  targetId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      fn();
    };
    const timer = setTimeout(
      () =>
        done(() =>
          reject(new HttpError(502, { error: "navigation timed out" })),
        ),
      5000,
    );
    let id = 0;
    ws.addEventListener("open", () => {
      id += 1;
      ws.send(
        JSON.stringify({
          id,
          method: "Target.activateTarget",
          params: { targetId },
        }),
      );
      id += 1;
      ws.send(JSON.stringify({ id, method: "Page.enable", params: {} }));
      id += 1;
      ws.send(JSON.stringify({ id, method: "Page.bringToFront", params: {} }));
      id += 1;
      ws.send(
        JSON.stringify({ id, method: "Page.navigate", params: { url } }),
      );
    });
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          method?: string;
          error?: unknown;
        };
        if (msg.error) {
          done(() =>
            reject(new HttpError(502, { error: "browser not running" })),
          );
          return;
        }
        if (msg.method === "Page.loadEventFired") {
          done(() => resolve());
        }
      } catch {
        /* ignore non-json */
      }
    });
    ws.addEventListener("error", () => {
      done(() => reject(new HttpError(502, { error: "browser not running" })));
    });
  });
}
