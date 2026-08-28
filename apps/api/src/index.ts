import { getRequestListener } from "@hono/node-server";
import { type Actor, type MachineOp } from "@webmcp-computer/contract";
import { Hono } from "hono";
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
import { getShot, listTape } from "./tape-store.ts";
import { HttpError } from "./http-error.ts";
import type { ComputerHost } from "./host.ts";
import { MemoryHost } from "./memory-host.ts";
import { Plane } from "./plane.ts";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT ?? 8787);
const VNC_USER = process.env.KASM_VNC_USER ?? "kasm_user";
const VNC_PASSWORD = process.env.KASM_VNC_PASSWORD ?? "password";
const VNC_AUTH =
  "Basic " + Buffer.from(`${VNC_USER}:${VNC_PASSWORD}`).toString("base64");

async function pickHost(): Promise<ComputerHost> {
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: 5_000,
    });
    const img = process.env.COMPUTER_IMAGE ?? "webmcp-slim:local";
    await execFileAsync("docker", ["image", "inspect", img], {
      timeout: 5_000,
    });
    const h = new DockerHost();
    await h.reconcile();
    console.log("computer host: docker");
    return h;
  } catch {
    console.log("computer host: memory");
    return new MemoryHost();
  }
}

let plane!: Plane;

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    allowHeaders: ["content-type", "x-actor"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));
app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/tape", async (c) => {
  return c.json({ events: await listTape() });
});

app.get("/api/tape/:id/:side", async (c) => {
  const side = c.req.param("side");
  if (side !== "before" && side !== "after") {
    return c.json({ error: "before or after" }, 400);
  }
  const buf = await getShot(c.req.param("id"), side);
  if (!buf) return c.body(null, 404);
  return new Response(buf, {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" },
  });
});

app.get("/api/computers", async (c) => {
  return c.json({ computers: await plane.listComputers() });
});

app.post("/api/computers", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      role?: string;
    };
    return c.json(await plane.spawn(body, actorOf(c)), 201);
  } catch (err) {
    return handleError(c, err);
  }
});

app.delete("/api/computers/:id", async (c) => {
  try {
    return c.json(await plane.destroy(c.req.param("id"), actorOf(c)));
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
    return c.json(await plane.rename(c.req.param("id"), body.name, actorOf(c)));
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
        String(body.question ?? ""),
        Array.isArray(body.options) ? body.options.map(String) : [],
        actorOf(c),
      ),
    );
  } catch (err) {
    return handleError(c, err);
  }
});

app.get("/api/workspace", async (c) => c.json(await plane.workspace()));

app.post("/api/workspace/select", async (c) => {
  try {
    const body = (await c.req.json()) as { computerId?: string };
    const id = body.computerId;
    if (typeof id !== "string" || !id.trim()) {
      throw new HttpError(400, { error: "computerId required" });
    }
    return c.json(await plane.select(id.trim(), actorOf(c)));
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
    return c.json(await plane.act(op, actorOf(c)));
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/api/approvals/:id/approve", async (c) => {
  try {
    return c.json(await plane.resolveApproval(c.req.param("id"), "approved"));
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/api/approvals/:id/reject", async (c) => {
  try {
    return c.json(await plane.resolveApproval(c.req.param("id"), "rejected"));
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
    return c.json(await plane.resolveChoice(c.req.param("id"), body.choice));
  } catch (err) {
    return handleError(c, err);
  }
});

function actorOf(c: { req: { header: (name: string) => string | undefined } }): Actor {
  const h = c.req.header("x-actor");
  if (h === "human" || h === "agent" || h === "system") return h;
  return "agent";
}

function handleError(
  c: { json: (b: unknown, s?: number) => Response },
  err: unknown,
) {
  if (err instanceof HttpError) {
    return c.json(err.body, err.status as 400 | 404 | 409 | 500 | 502);
  }
  return c.json({ error: "internal" }, 500);
}

function desktopProxy(target: string) {
  const host = new URL(target).host;
  const proxy = httpProxy.createProxyServer({
    target,
    ws: true,
    changeOrigin: true,
    secure: false,
    headers: { Authorization: VNC_AUTH, Host: host },
  });
  proxy.on("error", failDesktop);
  proxy.on("proxyReq", (proxyReq) => {
    proxyReq.setHeader("Host", host);
    proxyReq.setHeader("Authorization", VNC_AUTH);
  });
  proxy.on("proxyRes", (proxyRes) => {
    delete proxyRes.headers["cross-origin-embedder-policy"];
    delete proxyRes.headers["cross-origin-opener-policy"];
    delete proxyRes.headers["x-frame-options"];
    delete proxyRes.headers["content-security-policy"];
    delete proxyRes.headers["permissions-policy"];
    proxyRes.headers["origin-agent-cluster"] = "?1";
    proxyRes.headers["permissions-policy"] = "unload=*, tools=(self)";
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
</style>
</head>
<body>
<div id="screen"></div>
<script type="module">
import RFB from "./core/rfb.js";
const proto = location.protocol === "https:" ? "wss" : "ws";
const base = location.pathname.replace(/[^/]*$/, "");
const rfb = new RFB(document.getElementById("screen"), proto + "://" + location.host + base + "websockify");
rfb.scaleViewport = true;
rfb.resizeSession = true;
</script>
</body>
</html>
`;
}

function desktopMatch(url: string): { id: string; rest: string } | null {
  const m = url.match(/^\/desktops\/([^/?#]+)(\/.*)?(\?.*)?$/);
  if (!m || !m[1]) return null;
  const pathPart = m[2] && m[2].length > 0 ? m[2] : "/";
  const query = m[3] ?? "";
  return { id: decodeURIComponent(m[1]), rest: pathPart + query };
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
    const target = plane.vncUrl(parsed.id);
    if (!target) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("desktop offline");
      return;
    }
    const viewPath = parsed.rest.split("?")[0] ?? "/";
    if (
      viewPath === "/" ||
      viewPath === "/index.html" ||
      viewPath === "/vnc.html"
    ) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(vncViewerHtml());
      return;
    }
    if (parsed.rest.startsWith("/package.json")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"name":"novnc","version":"1.3.0"}');
      return;
    }
    req.url = parsed.rest;
    req.headers.authorization = VNC_AUTH;
    proxyFor(target).web(req, res, {}, (err) => failDesktop(err, req, res));
    return;
  }
  honoListener(req, res);
});

const wss = new WebSocketServer({ noServer: true });
const sockets = new Set<WebSocket>();

wss.on("connection", (ws) => {
  sockets.add(ws);
  ws.on("close", () => sockets.delete(ws));
});

server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  if (url.startsWith("/api/ws")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }
  const parsed = desktopMatch(url);
  if (parsed) {
    const target = plane.vncUrl(parsed.id);
    if (!target) {
      socket.destroy();
      return;
    }
    req.url = parsed.rest;
    socket.on("error", () => {});
    if (target.startsWith("https:")) {
      pipeKasmWs(target, req, socket, head);
    } else {
      proxyFor(target).ws(req, socket, head);
    }
    return;
  }
  socket.destroy();
});

void (async () => {
  plane = new Plane(await pickHost());
  plane.subscribe((event) => {
    const payload = JSON.stringify(event);
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  });
  await plane.boot().catch((err: unknown) => {
    console.error("boot spawn failed:", err);
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`control plane http://127.0.0.1:${PORT}`);
  });
})();
