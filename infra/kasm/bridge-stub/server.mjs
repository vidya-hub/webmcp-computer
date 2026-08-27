import http from "node:http";
import os from "node:os";

const PORT = Number(process.env.PORT ?? 8080);
const MACHINE_ID = process.env.MACHINE_ID || "machine";
const MACHINE_NAME = process.env.MACHINE_NAME || MACHINE_ID;
const started = Date.now();

function snapshot() {
  return {
    id: MACHINE_ID,
    name: MACHINE_NAME,
    os: "Ubuntu 24.04",
    hostname: os.hostname(),
    uptime: Math.floor((Date.now() - started) / 1000),
    cpuPercent: 1,
    memory: { used: "0.5GB", total: "4GB" },
    disk: { used: "2.0GB", total: "20GB" },
    foregroundApplication: "unknown",
    browserStatus: "stopped",
  };
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (req.method === "GET" && url === "/health") {
    send(res, 200, { ok: true, id: MACHINE_ID });
    return;
  }
  if (req.method === "POST" && url === "/act") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      send(res, 400, { error: "invalid op" });
      return;
    }
    if (body && body.op === "snapshot") {
      send(res, 200, snapshot());
      return;
    }
    send(res, 501, { error: "not implemented" });
    return;
  }
  send(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`bridge-stub ${MACHINE_ID} http://0.0.0.0:${PORT}`);
});
