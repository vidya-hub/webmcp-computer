const http = require("node:http");

const id = process.env.MACHINE_ID || "machine";
const name = process.env.MACHINE_NAME || id;

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (req.method === "GET" && url === "/health") {
    json(res, 200, { ok: true, id });
    return;
  }
  if (req.method === "POST" && url === "/act") {
    json(res, 501, { error: "stub" });
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
