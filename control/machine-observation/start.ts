/**
 * หน้าที่: the long-lived entrypoint for the observation runtime, shaped to fit
 * the EXISTING service mechanism (Owner, 2026-08-26).
 *
 * `control/runtime-control/` manages services as macOS LaunchAgents and probes
 * each one over HTTP — its `ServiceDefinition` requires a `port` and a
 * `health_path`. That is why this file serves a tiny stdlib HTTP surface: not
 * because the observer needs an API, but because that is the shape the
 * existing supervisor already knows how to start, stop and health-check. No
 * second service mechanism was introduced.
 *
 * READ-ONLY EXCEPT ONE APPEND. The only write anywhere on this path is an
 * append to `./data/observations.jsonl`. This file starts no agent, kills
 * nothing, authorizes nothing and deletes nothing.
 *
 * Input: env `MACHINE_OBSERVER_PORT` (default 5179),
 * `MACHINE_OBSERVER_REFRESH_MS` (default 15000),
 * `MACHINE_OBSERVER_SCREENSHOT_KEEP` (default 20 — how many historical render
 * screenshots the storage lifecycle keeps when this runtime submits them).
 * Output: `GET /health` (what runtime-control probes), `GET /status` (scopes,
 * store counts, scope-change history).
 * Dependency ที่อนุญาต: ./observer-daemon.ts, ./observation-store.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม route ที่เขียน/สั่งงานอะไรก็ตาม — this surface is
 * observation status only.
 */

declare const require: any;
declare const process: { env: Record<string, string | undefined>; on(event: string, handler: () => void): void };
declare const console: { log(...args: unknown[]): void };

import { startObservationRuntime } from "./observer-daemon";

const http = require("node:http");

const port = Number(process.env.MACHINE_OBSERVER_PORT ?? "5179");
const refreshMs = Number(process.env.MACHINE_OBSERVER_REFRESH_MS ?? "15000");

// The storage lifecycle keeps this many historical screenshots. Declared here,
// on the service entrypoint, so the number a running system uses is visible in
// one place rather than buried in a call site.
const screenshotKeepNewest = Number(process.env.MACHINE_OBSERVER_SCREENSHOT_KEEP ?? "20");

const handle = startObservationRuntime({ refreshMs, refreshPaths: [], screenshotKeepNewest });

const server = http.createServer((req: { url?: string; method?: string }, res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }) => {
  const url = req.url ?? "/";
  if (url === "/health") {
    const status = handle.status();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, observing: status.observing.observing, records: status.store.records, last_refresh: status.last_refresh }));
    return;
  }
  if (url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, ...handle.status() }, null, 1));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.listen(port, "127.0.0.1");
console.log(`machine-observer listening on 127.0.0.1:${port} (refresh ${refreshMs}ms)`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    handle.stop();
    try { server.close(); } catch { /* already closing */ }
  });
}
