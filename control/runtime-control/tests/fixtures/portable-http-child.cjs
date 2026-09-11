const http = require("node:http");

const port = Number(process.env.PORT || 0);
const mode = process.env.DNA_OS_TEST_HEALTH || "ok";
const crashMs = Number(process.env.DNA_OS_TEST_CRASH_MS || 0);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    if (mode === "unhealthy") {
      res.writeHead(503);
      res.end("unhealthy");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, "127.0.0.1");

if (crashMs > 0) {
  setTimeout(() => process.exit(2), crashMs);
}
