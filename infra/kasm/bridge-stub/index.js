const http = require("node:http");

const id = process.env.MACHINE_ID === "forge" ? "forge" : "nova";
const name = id === "forge" ? "Forge" : "Nova";

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (req.method === "GET" && url === "/health") {
    json(res, 200, { ok: true, id });
    return;
  }
  if (req.method === "POST" && url === "/act") {
    readBody(req).then((raw) => {
      let op = {};
      try {
        op = JSON.parse(raw || "{}");
      } catch {
        json(res, 400, { error: "invalid op" });
        return;
      }
      if (op.op === "snapshot") {
        json(res, 200, {
          id,
          name,
          os: "Ubuntu 24.04",
          hostname: id,
          uptime: Math.floor(process.uptime()),
          cpuPercent: 1,
          memory: { used: "0.2GB", total: "4GB" },
          disk: { used: "1.0GB", total: "20GB" },
          foregroundApplication: "unknown",
          browserStatus: "stopped",
        });
        return;
      }
      json(res, 501, { error: "stub" });
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(8080, "0.0.0.0", () => {
  console.log(`bridge-stub ${id} :8080`);
});

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
