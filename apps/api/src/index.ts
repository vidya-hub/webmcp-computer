import { getRequestListener } from "@hono/node-server";
import { type MachineOp } from "@webmcp-computer/contract";
import { Hono } from "hono";
import crypto from "node:crypto";
import { cors } from "hono/cors";
import httpProxy from "http-proxy";
import { execFile } from "node:child_process";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import type { Duplex } from "node:stream";
import { promisify } from "node:util";
import { WebSocketServer, type WebSocket } from "ws";
import { DockerHost } from "./docker-host.ts";
import { getShot, listTape, startRetention } from "./tape-store.ts";
import { HttpError } from "./http-error.ts";
import type { ComputerHost } from "./host.ts";
import { MemoryHost } from "./memory-host.ts";
import { Plane } from "./plane.ts";
import {
  classifyDesktop,
  DESKTOP_PERMISSIONS,
  FRAME_ANCESTORS,
  originAllowed,
} from "./desktop-route.ts";
import { injectSelkiesCapture } from "./selkies-capture.ts";
import {
  type AppEnv,
  actorOf,
  requireAuth,
  userIdFromCookieHeader,
  userIdOf,
} from "./auth-middleware.ts";
import { redis } from "./redis.ts";
import {
  MemoryWorkspace,
  RedisWorkspace,
  type WorkspaceStore,
} from "./workspace-store.ts";

// Per-user workspace: Redis in production (replica-safe), in-memory for dev.
function workspaceStore(): WorkspaceStore {
  if (process.env.REDIS_URL || IS_PROD) return new RedisWorkspace(redis);
  return new MemoryWorkspace();
}

process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  // Let systemd restart us rather than limp on in an unknown state.
  process.exit(1);
});

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT ?? 8787);
const HOST_BACKEND = (process.env.HOST_BACKEND ?? "auto").toLowerCase();

// Production = auth is required or the docker backend is pinned. In production
// missing dependencies are fatal: we exit so systemd restarts us rather than
// serving a degraded, single-tenant, or MemoryHost-backed lab.
const AUTH_REQUIRED =
  (process.env.AUTH_REQUIRED ?? "").toLowerCase() === "true";
const IS_PROD = AUTH_REQUIRED || HOST_BACKEND === "docker";

function fatal(msg: string): never {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

// An accidental restart with docker but without AUTH_REQUIRED serves every
// request as a single dev tenant (requireAuth's dev fallback). That's the
// intended safety net, but it must be loud. Flip AUTH_REQUIRED=true only once
// the SPA AuthGate ships.
if (HOST_BACKEND === "docker" && !AUTH_REQUIRED) {
  console.warn(
    "WARNING: HOST_BACKEND=docker but AUTH_REQUIRED is not true — all requests act as a single tenant (dev-user).",
  );
}
if (AUTH_REQUIRED && !process.env.JWT_SECRET) {
  fatal("AUTH_REQUIRED=true but JWT_SECRET is missing");
}

// Origins allowed to drive the control plane from a browser. The deployed
// Tailscale origin must be listed here (deploy/.env ALLOWED_ORIGINS=...) or the
// app's own same-origin POSTs will be rejected. Non-browser clients (curl,
// native MCP) send no Origin and are allowed; the check only defends against a
// browser on another origin (CSRF / WS hijack).
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function originOk(origin: string | undefined | null): boolean {
  return originAllowed(origin, ALLOWED_ORIGINS);
}
const VNC_USER = process.env.KASM_VNC_USER ?? "kasm_user";
const VNC_PASSWORD = process.env.KASM_VNC_PASSWORD ?? "password";
const VNC_AUTH =
  "Basic " + Buffer.from(`${VNC_USER}:${VNC_PASSWORD}`).toString("base64");

async function probeDocker(): Promise<DockerHost> {
  await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    timeout: 5_000,
  });
  const img = process.env.COMPUTER_IMAGE ?? "webmcp-slim:local";
  await execFileAsync("docker", ["image", "inspect", img], {
    timeout: 5_000,
  });
  const h = new DockerHost();
  await h.reconcile();
  return h;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pickHost(): Promise<ComputerHost> {
  if (HOST_BACKEND === "memory") {
    console.log("computer host: memory (forced)");
    return new MemoryHost();
  }
  if (HOST_BACKEND === "docker") {
    // In production we must never silently serve a fake desktop. Retry the
    // probe a few times (docker/daemon may still be coming up), then bail so
    // systemd restarts us instead of degrading to MemoryHost.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const h = await probeDocker();
        console.log("computer host: docker");
        return h;
      } catch (err) {
        lastErr = err;
        await sleep(2_000);
      }
    }
    console.error("FATAL: docker probe failed after retries:", lastErr);
    process.exit(1);
  }
  // auto: fall back to memory, but loudly.
  try {
    const h = await probeDocker();
    console.log("computer host: docker");
    return h;
  } catch (err) {
    console.error("DOCKER PROBE FAILED — falling back to MemoryHost:", err);
    return new MemoryHost();
  }
}

let plane!: Plane;

const app = new Hono<AppEnv>();

// Request id in and out, for correlating structured logs.
app.use("*", async (c, next) => {
  const id = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  return next();
});

app.use(
  "*",
  cors({
    origin: [...ALLOWED_ORIGINS],
    // Cookies carry the session; the browser must be allowed to send them.
    credentials: true,
    allowHeaders: ["content-type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

// Server-side CSRF guard: CORS only blocks a cross-origin page from *reading*
// the response; a no-preflight POST (e.g. /api/approvals/:id/approve) still
// executes. Reject mutating requests whose Origin is a browser origin we don't
// trust, before any handler runs.
app.use("/api/*", async (c, next) => {
  const method = c.req.method;
  if (method === "POST" || method === "PUT" || method === "DELETE") {
    if (!originOk(c.req.header("origin"))) {
      return c.json({ error: "origin not allowed" }, 403);
    }
  }
  return next();
});

app.get("/health", (c) => c.json({ ok: true }));
app.get("/api/health", (c) => c.json({ ok: true }));

// Readiness: dependencies up. The load balancer routes on this, not /health.
app.get("/api/ready", async (c) => {
  const [{ pingPg }, { pingRedis }] = await Promise.all([
    import("./pg.ts"),
    import("./redis.ts"),
  ]);
  const needsData = !!process.env.DATABASE_URL || IS_PROD;
  const [pg, redis] = await Promise.all([
    needsData ? pingPg() : Promise.resolve(true),
    needsData ? pingRedis() : Promise.resolve(true),
  ]);
  const ok = pg && redis;
  return c.json({ ok, pg, redis }, ok ? 200 : 503);
});

// Session gate for the whole control-plane API (health/ready stay open).
app.use("/api/*", async (c, next) => {
  const p = c.req.path;
  if (p === "/api/health" || p === "/api/ready") return next();
  return requireAuth(c, next);
});

app.get("/api/tape", async (c) => {
  return c.json({ events: await listTape(userIdOf(c)) });
});

app.get("/api/tape/:id/:side", async (c) => {
  const side = c.req.param("side");
  if (side !== "before" && side !== "after") {
    return c.json({ error: "before or after" }, 400);
  }
  const buf = await getShot(userIdOf(c), c.req.param("id"), side);
  if (!buf) return c.body(null, 404);
  return new Response(buf, {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" },
  });
});

// --- Recorded actions (recipes) ---
app.get("/api/actions", async (c) => {
  return c.json({ actions: await plane.listActions(userIdOf(c)) });
});

app.get("/api/actions/:id", async (c) => {
  const a = await plane.getRecordedAction(userIdOf(c), c.req.param("id"));
  if (!a) return c.json({ error: "not found" }, 404);
  return c.json(a);
});

app.post("/api/actions", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      steps?: unknown;
    };
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new HttpError(400, { error: "name required" });
    }
    return c.json(
      await plane.saveRecordedAction(
        userIdOf(c),
        {
          name: body.name,
          description: body.description,
          steps: (body.steps ?? []) as never,
        },
        actorOf(c),
      ),
    );
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/api/actions/promote", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      count?: number;
      name?: string;
      description?: string;
    };
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new HttpError(400, { error: "name required" });
    }
    return c.json(
      await plane.promoteRecent(
        userIdOf(c),
        Number(body.count ?? 10),
        body.name,
        body.description ?? "",
      ),
    );
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/api/actions/:id/replay", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { speed?: number };
    return c.json(
      await plane.replayRecordedAction(
        userIdOf(c),
        { actionId: c.req.param("id") },
        Number(body.speed ?? 1),
        actorOf(c),
      ),
    );
  } catch (err) {
    return handleError(c, err);
  }
});

app.delete("/api/actions/:id", async (c) => {
  try {
    return c.json(
      await plane.deleteRecordedAction(userIdOf(c), c.req.param("id")),
    );
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Live recording (viewer human input; agent ops captured via /api/act) ---
const RECORD_INPUT_KINDS = new Set([
  "click",
  "drag",
  "scroll",
  "type",
  "key",
  "wait",
]);

app.post("/api/record/start", async (c) => {
  try {
    return c.json(await plane.recordStart(userIdOf(c), actorOf(c)));
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/api/record/event", async (c) => {
  try {
    const step = (await c.req.json().catch(() => ({}))) as { kind?: string };
    if (typeof step.kind !== "string" || !RECORD_INPUT_KINDS.has(step.kind)) {
      throw new HttpError(400, { error: "invalid record step" });
    }
    // The API stamps `t` on accept; any client-supplied t/computerId is ignored.
    return c.json(await plane.recordEvent(userIdOf(c), step, actorOf(c)));
  } catch (err) {
    return handleError(c, err);
  }
});

app.get("/api/record/status", async (c) =>
  c.json(await plane.recordStatus(userIdOf(c))),
);

app.post("/api/record/stop", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
    };
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new HttpError(400, { error: "name required" });
    }
    return c.json(
      await plane.recordStop(
        userIdOf(c),
        body.name,
        body.description ?? "",
        actorOf(c),
      ),
    );
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Home archives ---
app.get("/api/archives", async (c) => {
  return c.json({ archives: await plane.listArchives(userIdOf(c)) });
});

app.delete("/api/archives/:id", async (c) => {
  try {
    return c.json(await plane.deleteArchive(userIdOf(c), c.req.param("id")));
  } catch (err) {
    return handleError(c, err);
  }
});

app.get("/api/computers", async (c) => {
  return c.json({ computers: await plane.listComputers(userIdOf(c)) });
});

app.post("/api/computers", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      role?: string;
      restoreArchiveId?: string;
    };
    return c.json(await plane.spawn(userIdOf(c), body, actorOf(c)), 201);
  } catch (err) {
    return handleError(c, err);
  }
});

app.delete("/api/computers/:id", async (c) => {
  try {
    return c.json(await plane.destroy(userIdOf(c), c.req.param("id"), actorOf(c)));
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/api/computers/:id/name", async (c) => {
  try {
    const body = (await c.req.json()) as { name?: string };
    if (typeof body.name !== "string") {
      throw new HttpError(400, { error: "name required" });
    }
    return c.json(
      await plane.rename(userIdOf(c), c.req.param("id"), body.name, actorOf(c)),
    );
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/api/choice", async (c) => {
  try {
    const body = (await c.req.json()) as {
      question?: string;
      options?: string[];
    };
    return c.json(
      await plane.requestChoice(
        userIdOf(c),
        String(body.question ?? ""),
        Array.isArray(body.options) ? body.options.map(String) : [],
        actorOf(c),
      ),
    );
  } catch (err) {
    return handleError(c, err);
  }
});

app.get("/api/workspace", async (c) =>
  c.json(await plane.workspace(userIdOf(c))),
);

app.post("/api/workspace/select", async (c) => {
  try {
    const body = (await c.req.json()) as { computerId?: string };
    const id = body.computerId;
    if (typeof id !== "string" || !id.trim()) {
      throw new HttpError(400, { error: "computerId required" });
    }
    return c.json(await plane.select(userIdOf(c), id.trim(), actorOf(c)));
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/api/act", async (c) => {
  try {
    const op = (await c.req.json()) as MachineOp;
    if (!op || typeof op !== "object" || typeof op.op !== "string") {
      throw new HttpError(400, { error: "invalid op" });
    }
    return c.json(await plane.act(userIdOf(c), op, actorOf(c)));
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/api/approvals/:id/approve", async (c) => {
  try {
    return c.json(
      await plane.resolveApproval(userIdOf(c), c.req.param("id"), "approved"),
    );
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/api/approvals/:id/reject", async (c) => {
  try {
    return c.json(
      await plane.resolveApproval(userIdOf(c), c.req.param("id"), "rejected"),
    );
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/api/approvals/:id/choose", async (c) => {
  try {
    const body = (await c.req.json()) as { choice?: string };
    if (typeof body.choice !== "string") {
      throw new HttpError(400, { error: "choice required" });
    }
    return c.json(
      await plane.resolveChoice(userIdOf(c), c.req.param("id"), body.choice),
    );
  } catch (err) {
    return handleError(c, err);
  }
});

function handleError(
  c: { json: (b: unknown, s?: number) => Response },
  err: unknown,
) {
  if (err instanceof HttpError) {
    return c.json(
      err.body,
      err.status as 400 | 403 | 404 | 409 | 429 | 500 | 502 | 503,
    );
  }
  // Unexpected errors were previously a black hole — every 500 is now logged.
  console.error("api error:", err);
  return c.json({ error: "internal" }, 500);
}

function desktopProxy(target: string) {
  const guest = new URL(target);
  const host = guest.host;
  const guestOrigin = guest.origin;
  const proxy = httpProxy.createProxyServer({
    target,
    ws: true,
    changeOrigin: true,
    secure: false,
    headers: { Host: host },
  });
  proxy.on("error", failDesktop);
  const towardGuest = (proxyReq: http.ClientRequest, req: http.IncomingMessage) => {
    proxyReq.setHeader("Host", host);
    // Selkies/aiohttp CORS-checks Origin against its loopback listener. The
    // browser Origin is already enforced by originOk(); do not forward it.
    proxyReq.setHeader("Origin", guestOrigin);
    proxyReq.setHeader("Referer", `${guestOrigin}/`);
    const auth = req.headers.authorization ?? VNC_AUTH;
    proxyReq.setHeader("Authorization", Array.isArray(auth) ? auth[0] : auth);
  };
  proxy.on("proxyReq", towardGuest);
  proxy.on("proxyReqWs", towardGuest);
  proxy.on("proxyRes", (proxyRes) => {
    delete proxyRes.headers["cross-origin-embedder-policy"];
    delete proxyRes.headers["cross-origin-opener-policy"];
    delete proxyRes.headers["x-frame-options"];
    // Set (do not strip) frame-ancestors so a foreign origin cannot iframe the
    // stream. permissions-policy keeps unload/tools/clipboard on this origin.
    proxyRes.headers["content-security-policy"] = FRAME_ANCESTORS;
    proxyRes.headers["origin-agent-cluster"] = "?1";
    proxyRes.headers["permissions-policy"] = DESKTOP_PERMISSIONS;
  });
  return proxy;
}

function failDesktop(
  _err: Error,
  _req: http.IncomingMessage,
  res: http.ServerResponse | import("stream").Duplex,
) {
  if ("writeHead" in res && !res.headersSent) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("desktop offline");
  } else if ("destroy" in res) {
    res.destroy();
  }
}

const proxies = new Map<string, ReturnType<typeof desktopProxy>>();

function proxyFor(target: string) {
  let p = proxies.get(target);
  if (!p) {
    p = desktopProxy(target);
    proxies.set(target, p);
  }
  return p;
}

function pipeKasmWs(
  target: string,
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
) {
  const u = new URL(target);
  const origin = String(req.headers.origin ?? "http://127.0.0.1:5173");
  const key = String(req.headers["sec-websocket-key"] ?? "");
  const proto = req.headers["sec-websocket-protocol"];
  const protoValue = Array.isArray(proto) ? proto.join(", ") : proto;
  const protoLine = protoValue
    ? `Sec-WebSocket-Protocol: ${protoValue}\r\n`
    : "Sec-WebSocket-Protocol: binary\r\n";
  const path = req.url ?? "/websockify";
  const handshake =
    `GET ${path} HTTP/1.1\r\n` +
    `Host: ${u.host}\r\n` +
    `Authorization: ${VNC_AUTH}\r\n` +
    `Upgrade: websocket\r\n` +
    `Connection: Upgrade\r\n` +
    `Sec-WebSocket-Key: ${key}\r\n` +
    `Sec-WebSocket-Version: 13\r\n` +
    protoLine +
    `Origin: ${origin}\r\n` +
    `Sec-WebSocket-Origin: ${origin}\r\n` +
    `\r\n`;
  const tlsUp = u.protocol === "https:";
  const upstream = tlsUp
    ? tls.connect({
        host: u.hostname,
        port: Number(u.port),
        rejectUnauthorized: false,
      })
    : net.connect({ host: u.hostname, port: Number(u.port) });
  const fail = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on("error", fail);
  socket.on("error", fail);
  const onReady = () => {
    upstream.write(handshake);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  };
  if (tlsUp) upstream.once("secureConnect", onReady);
  else upstream.once("connect", onReady);
}

function vncViewerHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
html,body,#screen{margin:0;height:100%;background:#111}
#overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;
  background:rgba(10,10,12,.82);color:#e6e6e6;font:13px/1.5 -apple-system,system-ui,sans-serif;
  flex-direction:column;gap:10px;z-index:10}
#overlay.on{display:flex}
#overlay .dot{width:8px;height:8px;border-radius:50%;background:#febc2e;
  box-shadow:0 0 12px #febc2e;animation:pulse 1.1s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
#overlay button{margin-top:6px;background:rgba(255,255,255,.1);border:0;color:#fff;
  border-radius:6px;padding:6px 14px;font:inherit;cursor:pointer}
</style>
</head>
<body>
<div id="screen"></div>
<div id="overlay"><span class="dot"></span><span id="msg">desktop disconnected — reconnecting…</span></div>
<script type="module">
import RFB from "./core/rfb.js";
const proto = location.protocol === "https:" ? "wss" : "ws";
const base = location.pathname.replace(/[^/]*$/, "");
const url = proto + "://" + location.host + base + "websockify";
const screen = document.getElementById("screen");
const overlay = document.getElementById("overlay");
const msg = document.getElementById("msg");
let attempt = 0;
let rfb = null;
function connect(){
  overlay.classList.remove("on");
  rfb = new RFB(screen, url);
  rfb.scaleViewport = true;
  applyResize(); // don't renegotiate size mid-record/replay
  rfb.addEventListener("connect", () => { attempt = 0; overlay.classList.remove("on"); });
  rfb.addEventListener("disconnect", scheduleReconnect);
  rfb.addEventListener("securityfailure", scheduleReconnect);
}
function scheduleReconnect(){
  overlay.classList.add("on");
  if (attempt >= 5){
    msg.innerHTML = 'desktop unavailable <button onclick="location.reload()">Reload</button>';
    return;
  }
  const delay = Math.min(8000, 1000 * Math.pow(2, attempt));
  attempt++;
  msg.textContent = "desktop disconnected — reconnecting… (" + attempt + ")";
  setTimeout(connect, delay);
}

// --- Record capture (viewer-first). Observe-only: never preventDefault, so
// noVNC still delivers input to the guest. Emit normalized steps to the parent.
let recording = false;
let replayLock = false;
function applyResize(){ if(rfb) rfb.resizeSession = !recording && !replayLock; }
const KEYMAP = { Enter:"Return", Tab:"Tab", Backspace:"BackSpace", Escape:"Escape",
  Delete:"Delete", ArrowUp:"Up", ArrowDown:"Down", ArrowLeft:"Left", ArrowRight:"Right",
  Home:"Home", End:"End", PageUp:"Prior", PageDown:"Next", " ":"space" };
let typeBuf = "";
let typeTimer = 0;
let down = null; // {x,y,t,button,moved}
function post(step){ try { window.parent.postMessage({ source:"webmcp", type:"record-step", step }, location.origin); } catch(e){} }
function flushType(){ if(typeBuf){ post({ kind:"type", text: typeBuf }); typeBuf=""; } if(typeTimer){ clearTimeout(typeTimer); typeTimer=0; } }
function canvas(){ return screen.querySelector("canvas"); }
function fb(ev){
  const cv = canvas(); if(!cv) return null;
  const r = cv.getBoundingClientRect();
  if(!r.width || !r.height) return null;
  return { x: Math.round((ev.clientX - r.left) * cv.width / r.width),
           y: Math.round((ev.clientY - r.top) * cv.height / r.height) };
}
const btn = (b) => b===2?"right":b===1?"middle":"left";
function onDown(ev){ const p=fb(ev); if(!p) return; flushType(); down={ x:p.x, y:p.y, t:Date.now(), button:ev.button, moved:false }; }
function onMove(ev){ if(!down) return; const p=fb(ev); if(!p) return; if(Math.abs(p.x-down.x)>4||Math.abs(p.y-down.y)>4) down.moved=true; }
let lastClick = null;
function onUp(ev){ if(!down) return; const p=fb(ev)||down;
  if(down.moved){ post({ kind:"drag", fromX:down.x, fromY:down.y, toX:p.x, toY:p.y }); lastClick=null; }
  else { const dbl = lastClick && (Date.now()-lastClick.t<400) && Math.abs(p.x-lastClick.x)<=4 && Math.abs(p.y-lastClick.y)<=4;
    post({ kind:"click", x:p.x, y:p.y, button:btn(down.button), clicks: dbl?2:1 });
    lastClick = dbl ? null : { x:p.x, y:p.y, t:Date.now() }; }
  down=null; }
function onWheel(ev){ const p=fb(ev); if(!p) return; flushType(); post({ kind:"scroll", x:p.x, y:p.y, dy: ev.deltaY<0?-1:1 }); }
function onKey(ev){
  const mods=[]; if(ev.ctrlKey)mods.push("ctrl"); if(ev.altKey)mods.push("alt"); if(ev.metaKey)mods.push("super");
  const printable = ev.key.length===1 && mods.length===0;
  if(printable && ev.key!==" "){ typeBuf+=ev.key; if(typeTimer)clearTimeout(typeTimer); typeTimer=setTimeout(flushType,400); return; }
  // chord / non-printable / space
  flushType();
  const base = KEYMAP[ev.key] || (ev.key.length===1 ? ev.key.toLowerCase() : ev.key);
  const chord = ev.shiftKey && mods.length ? [...mods,"shift",base].join("+") : [...mods,base].join("+");
  post({ kind:"key", keys: chord });
}
function setRecording(on){
  if(on===recording) return;
  recording = on;
  applyResize();
  const opts = { capture:true, passive:true };
  if(on){
    screen.addEventListener("pointerdown",onDown,opts);
    screen.addEventListener("pointermove",onMove,opts);
    screen.addEventListener("pointerup",onUp,opts);
    screen.addEventListener("wheel",onWheel,opts);
    window.addEventListener("keydown",onKey,{ capture:true });
  } else {
    flushType();
    screen.removeEventListener("pointerdown",onDown,opts);
    screen.removeEventListener("pointermove",onMove,opts);
    screen.removeEventListener("pointerup",onUp,opts);
    screen.removeEventListener("wheel",onWheel,opts);
    window.removeEventListener("keydown",onKey,{ capture:true });
    down=null; lastClick=null;
    try { window.parent.postMessage({ source:"webmcp", type:"record-flushed" }, location.origin); } catch(e){}
  }
}
window.addEventListener("message",(ev)=>{
  if(ev.origin!==location.origin) return;
  const d=ev.data;
  if(!d || d.source!=="webmcp") return;
  if(d.type==="record") setRecording(!!d.on);
  // Replay lock: do not renegotiate geometry while a recipe is playing back.
  else if(d.type==="replay"){ replayLock=!!d.on; applyResize(); }
});
connect();
</script>
</body>
</html>
`;
}


async function serveSelkiesHtml(
  res: http.ServerResponse,
  streamTarget: string,
  streamAuth: string | undefined,
  rest: string,
): Promise<void> {
  const pathOnly = rest.split("?")[0] || "/";
  const url = `${streamTarget.replace(/\/$/, "")}${pathOnly === "/" ? "/" : pathOnly}`;
  try {
    const up = await fetch(url, {
      headers: streamAuth ? { authorization: streamAuth } : {},
      signal: AbortSignal.timeout(8_000),
    });
    let html = await up.text();
    html = injectSelkiesCapture(html);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "content-security-policy": FRAME_ANCESTORS,
      "permissions-policy": DESKTOP_PERMISSIONS,
    });
    res.end(html);
  } catch (err) {
    failDesktop(
      err instanceof Error ? err : new Error("selkies html failed"),
      { url: rest } as http.IncomingMessage,
      res,
    );
  }
}

function desktopMatch(url: string): { id: string; rest: string } | null {
  const m = url.match(/^\/desktops\/([^/?#]+)(\/.*)?(\?.*)?$/);
  if (!m || !m[1]) return null;
  const pathPart = m[2] && m[2].length > 0 ? m[2] : "/";
  const query = m[3] ?? "";
  return { id: decodeURIComponent(m[1]), rest: pathPart + query };
}

// Serve a desktop HTTP sub-request. Called only after Origin + session + owner
// checks pass, so it can trust the request is for a computer this user owns.
function serveDesktop(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parsed: { id: string; rest: string },
): void {
  const vncTarget = plane.vncUrl(parsed.id);
  const streamTarget = plane.streamUrl(parsed.id);
  const streamAuth = plane.streamAuth(parsed.id);
  const kind = classifyDesktop(parsed.rest, Boolean(streamTarget));
  if (kind === "package-stub") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"name":"novnc","version":"1.3.0"}');
    return;
  }
  if (kind === "html-rfb") {
    if (!vncTarget) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("desktop offline");
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "content-security-policy": FRAME_ANCESTORS,
      "permissions-policy": DESKTOP_PERMISSIONS,
    });
    res.end(vncViewerHtml());
    return;
  }
  if (kind === "html-stream") {
    if (!streamTarget) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("desktop offline");
      return;
    }
    void serveSelkiesHtml(res, streamTarget, streamAuth, parsed.rest);
    return;
  }
  if (kind === "selkies") {
    if (!streamTarget) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("desktop offline");
      return;
    }
    req.url = parsed.rest;
    if (streamAuth) req.headers.authorization = streamAuth;
    proxyFor(streamTarget).web(req, res, {}, (err) => failDesktop(err, req, res));
    return;
  }
  // novnc leftovers (websockify static, core/*)
  if (!vncTarget) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("desktop offline");
    return;
  }
  req.url = parsed.rest;
  req.headers.authorization = VNC_AUTH;
  proxyFor(vncTarget).web(req, res, {}, (err) => failDesktop(err, req, res));
}

const honoListener = getRequestListener(app.fetch);
const server = http.createServer((req, res) => {
  const slash = (req.url ?? "").match(/^\/desktops\/([^/?#]+)(\?.*)?$/);
  if (slash?.[1]) {
    res.writeHead(301, {
      location: `/desktops/${slash[1]}/${slash[2] ?? ""}`,
    });
    res.end();
    return;
  }
  const parsed = desktopMatch(req.url ?? "");
  if (parsed) {
    if (!originOk(
      Array.isArray(req.headers.origin)
        ? req.headers.origin[0]
        : req.headers.origin,
    )) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("origin not allowed");
      return;
    }
    // Session + ownership gate: only the owner can reach their computer's
    // stream. The wc_at cookie rides the same-origin request.
    void userIdFromCookieHeader(req.headers.cookie)
      .then((userId) => {
        if (!userId) {
          res.writeHead(401, { "content-type": "text/plain" });
          res.end("unauthenticated");
          return;
        }
        if (!plane.owns(userId, parsed.id)) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found");
          return;
        }
        serveDesktop(req, res, parsed);
      })
      .catch(() => {
        try {
          res.writeHead(500);
          res.end();
        } catch {
          /* already sent */
        }
      });
    return;
  }
  honoListener(req, res);
});

const wss = new WebSocketServer({ noServer: true });
// Each event-feed socket is bound to the userId resolved from its cookie at
// upgrade, so a user only ever receives their own events.
const socketUser = new Map<WebSocket, string>();

server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  if (url.startsWith("/api/ws")) {
    // WebSockets are exempt from CORS; an unchecked upgrade would let any page
    // stream the event feed (approval IDs, commands). Enforce Origin + session.
    if (!originOk(req.headers.origin)) {
      socket.destroy();
      return;
    }
    void userIdFromCookieHeader(req.headers.cookie)
      .then((userId) => {
        if (!userId) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          socketUser.set(ws, userId);
          ws.on("close", () => socketUser.delete(ws));
        });
      })
      .catch(() => socket.destroy());
    return;
  }
  const parsed = desktopMatch(url);
  if (parsed) {
    if (!originOk(
      Array.isArray(req.headers.origin)
        ? req.headers.origin[0]
        : req.headers.origin,
    )) {
      socket.destroy();
      return;
    }
    // Session + ownership gate on the desktop stream upgrade too.
    void userIdFromCookieHeader(req.headers.cookie)
      .then((userId) => {
        if (!userId || !plane.owns(userId, parsed.id)) {
          socket.destroy();
          return;
        }
        proxyDesktopWs(req, socket, head, parsed);
      })
      .catch(() => socket.destroy());
    return;
  }
  socket.destroy();
});

// Proxy an owner-approved desktop WS upgrade to the guest.
function proxyDesktopWs(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  parsed: { id: string; rest: string },
): void {
  {
    const vncTarget = plane.vncUrl(parsed.id);
    const streamTarget = plane.streamUrl(parsed.id);
    const streamAuth = plane.streamAuth(parsed.id);
    const kind = classifyDesktop(parsed.rest, Boolean(streamTarget));
    const target =
      kind === "selkies" || kind === "html-stream" ? streamTarget : vncTarget;
    const auth =
      kind === "selkies" || kind === "html-stream" ? streamAuth : VNC_AUTH;
    if (!target) {
      socket.destroy();
      return;
    }
    req.url = parsed.rest;
    if (auth) req.headers.authorization = auth;
    // After originOk(), present the guest as its own origin so aiohttp CORS
    // does not reject the operator's Tailscale/HTTPS Origin.
    const guestOrigin = new URL(target).origin;
    req.headers.origin = guestOrigin;
    req.headers.referer = `${guestOrigin}/`;
    delete req.headers["sec-websocket-origin"];
    socket.on("error", () => {});
    if (target.startsWith("https:")) {
      pipeKasmWs(target, req, socket, head);
    } else {
      proxyFor(target).ws(req, socket, head);
    }
  }
}

void (async () => {
  plane = new Plane(await pickHost(), workspaceStore());
  plane.subscribe((userId, event) => {
    const payload = JSON.stringify(event);
    for (const [ws, uid] of socketUser) {
      if (uid === userId && ws.readyState === ws.OPEN) ws.send(payload);
    }
  });
  // Schema is owned by numbered migrations. In production the database and Redis
  // are required; a failure here is fatal (systemd restarts us).
  if (process.env.DATABASE_URL) {
    try {
      const { migrate } = await import("./migrate.ts");
      await migrate();
    } catch (err) {
      if (IS_PROD) fatal(`migration failed: ${String(err)}`);
      console.error("migration failed (dev, continuing):", err);
    }
  } else if (IS_PROD) {
    fatal("DATABASE_URL is required in production");
  }

  if (process.env.REDIS_URL || IS_PROD) {
    try {
      const { connectRedis } = await import("./redis.ts");
      await connectRedis();
    } catch (err) {
      if (IS_PROD) fatal(`redis connect failed: ${String(err)}`);
      console.error("redis connect failed (dev, continuing):", err);
    }
  }

  await plane.boot().catch((err: unknown) => {
    console.error("boot failed:", err);
  });
  startRetention();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`control plane http://127.0.0.1:${PORT}`);
  });
})();

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down`);
  try {
    plane.discardAllRecordings();
  } catch {
    // plane may not be assigned if boot never finished
  }
  // Hard deadline so a stuck close can't hang the unit forever.
  const deadline = setTimeout(() => process.exit(0), 5_000);
  deadline.unref();
  for (const ws of socketUser.keys()) {
    try {
      ws.close(1001, "server shutting down");
    } catch {
      // ignore
    }
  }
  server.close(() => {
    clearTimeout(deadline);
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
