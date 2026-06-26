/**
 * DNA OS Agent — Local macOS Service
 *
 * Board (Vercel) → Agent (Mac) → Driver Registry → LINE/Chrome/Finder/...
 *
 * รันบน macOS ตลอดเวลา รับคำสั่งผ่าน HTTP
 * Port 7777 by default
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { execFile } from "child_process";
import { join } from "path";
import { hostname, platform, release } from "os";

const PORT = parseInt(process.env.DNA_AGENT_PORT ?? "7777");
const DRIVERS_DIR = join(__dirname, "..", "drivers");

// ── Driver binaries ──
const driverBins: Record<string, string> = {
  line: join(DRIVERS_DIR, "line", "line-driver"),
};

// ── Agent Status ──
const startedAt = new Date();

function agentStatus(): Record<string, unknown> {
  return {
    agent: "online",
    hostname: hostname(),
    os: `${platform()} ${release()}`,
    startedAt: startedAt.toISOString(),
    uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    drivers: Object.keys(driverBins),
    port: PORT,
  };
}

// ── Call Driver ──
function callDriver(
  driver: string,
  command: string,
  args: Record<string, string>
): Promise<Record<string, unknown>> {
  const bin = driverBins[driver];
  if (!bin) {
    return Promise.resolve({
      success: false,
      error: `driver '${driver}' not found`,
      available: Object.keys(driverBins),
    });
  }

  const cliArgs = [driver, command];
  for (const [k, v] of Object.entries(args)) {
    cliArgs.push(`--${k}`, v);
  }

  return new Promise((resolve) => {
    execFile(bin, cliArgs, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, driver, command, error: stderr?.trim() || err.message });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ success: false, driver, command, error: "invalid json", raw: stdout });
      }
    });
  });
}

// ── HTTP Server ──
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  // GET /status
  if (path === "/status" && req.method === "GET") {
    const drivers: Record<string, unknown> = {};
    for (const name of Object.keys(driverBins)) {
      drivers[name] = await callDriver(name, "status", {});
    }
    respond(res, 200, { ...agentStatus(), driverStatus: drivers });
    return;
  }

  // POST /call — { driver, command, args }
  if (path === "/call" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.driver || !body.command) {
      respond(res, 400, { error: "missing driver or command" });
      return;
    }
    const result = await callDriver(body.driver, body.command, body.args ?? {});
    respond(res, result.success ? 200 : 400, result);
    return;
  }

  // GET /drivers
  if (path === "/drivers" && req.method === "GET") {
    respond(res, 200, { drivers: Object.keys(driverBins) });
    return;
  }

  // Shortcut: POST /line/send — { text }
  if (path.startsWith("/") && req.method === "POST") {
    const parts = path.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const [driver, command] = parts;
      const body = await readBody(req);
      const result = await callDriver(driver, command, body);
      respond(res, result.success ? 200 : 400, result);
      return;
    }
  }

  respond(res, 404, { error: "not found", endpoints: ["GET /status", "POST /call", "GET /drivers", "POST /:driver/:command"] });
});

server.listen(PORT, () => {
  console.log(`DNA OS Agent running on http://localhost:${PORT}`);
  console.log(`Drivers: ${Object.keys(driverBins).join(", ")}`);
  console.log(`Endpoints:`);
  console.log(`  GET  /status`);
  console.log(`  GET  /drivers`);
  console.log(`  POST /call     { driver, command, args }`);
  console.log(`  POST /line/send { text: "สวัสดี" }`);
});

// ── Helpers ──

function respond(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}
