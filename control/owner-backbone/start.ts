/**
 * หน้าที่: the long-lived entrypoint for the recovery supervisor, shaped to
 * fit the EXISTING service mechanism rather than introducing another one.
 *
 * WHY THIS SHAPE. `control/runtime-control/` already manages services as
 * macOS LaunchAgents and health-checks each one over HTTP — its
 * `ServiceDefinition` requires a `port` and a `health_path`. Serving a tiny
 * stdlib HTTP surface is therefore not an API decision; it is the shape the
 * existing supervisor already knows how to start, stop, probe and restart.
 * The same reasoning `control/machine-observation/start.ts` records for
 * itself, and the same mechanism — no second service system.
 *
 * WHAT KEEPS IT ALIVE: launchd, through `RunAtLoad` + `KeepAlive` in its
 * LaunchAgent. Nothing in DNA OS supervises this process, because the
 * machine already has a process supervisor and adding a second one would be
 * the exact duplication this repo refuses.
 *
 * WHAT IT HOLDS IN MEMORY: nothing that matters. Every fact it acts on is
 * re-read from the machine, and every decision it has made is re-read from
 * the durable evidence store. Killing this process loses no state — which
 * is what `tests/zero-touch-proof.test.ts` verifies rather than assumes.
 *
 * Input: env `RECOVERY_SUPERVISOR_PORT` (default 5180),
 * `RECOVERY_SUPERVISOR_INTERVAL_MS` (default 30000),
 * `RECOVERY_SUPERVISOR_SERVICES` (comma-separated; default every declared service).
 * Output: `GET /health` (what runtime-control probes), `GET /status`.
 * Dependency ที่อนุญาต: ./autonomous-recovery.ts, ../runtime-control/contract.ts,
 * node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม route ที่สั่งงานอะไรก็ตาม — this surface is
 * liveness and status only. A recovery must never be triggerable over HTTP;
 * it is triggered by machine facts.
 */

import { createServer } from "node:http";
import { startRecoverySupervisor } from "./autonomous-recovery";
import { SERVICES } from "../runtime-control/contract";
import { bootAll } from "../runtime-control/boot-orchestrator";
import type { RecoveryCycle } from "./autonomous-recovery";

const port = Number(process.env.RECOVERY_SUPERVISOR_PORT ?? "5180");
const intervalMs = Number(process.env.RECOVERY_SUPERVISOR_INTERVAL_MS ?? "30000");
const configured = (process.env.RECOVERY_SUPERVISOR_SERVICES ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);

/**
 * SELF-EXCLUSION. The supervisor never watches itself: launchd owns this
 * process's liveness, and a process that restarts itself on a failed
 * self-probe is a crash loop with extra steps.
 */
const SELF_SERVICE_ID = "recovery-supervisor";
const services = (configured.length > 0 ? configured : Object.keys(SERVICES as Record<string, unknown>)).filter((id) => id !== SELF_SERVICE_ID);

const startedAt = new Date().toISOString();
const acted: RecoveryCycle[] = [];

/**
 * COLD START ตามลำดับ dependency — ทำครั้งเดียวตอนโปรเซสนี้ขึ้น
 *
 * ตัว sweep ที่วนทุก 30 วินาทีตรวจทีละบริการแยกกัน ซึ่งถูกสำหรับการเฝ้าระวัง
 * แต่ตอน "เครื่องเพิ่งบูต" มันจะปลุกทุกตัวพร้อมกัน — control-workspace จึงขึ้นก่อน
 * joint-monitor/compute-api ที่มันต้องใช้ แล้วรายงาน dependency ของตัวเองว่า DOWN
 * ซึ่งบนหน้าจออ่านเหมือน dependency พังจริง
 *
 * bootAll เรียงตาม depends_on ใน SERVICES และมี FAILED_LOCKED ในตัว จึงไม่วนปลุก
 * บริการที่พังจริงจนกิน CPU ความล้มเหลวที่นี่ต้องไม่ล้ม supervisor — ถ้า boot
 * ไม่สำเร็จ รอบ sweep ปกติยังทำงานต่อ
 */
void bootAll()
  .then((report) => {
    console.log(`[boot] order=${report.order.join(" -> ")}`);
    for (const result of report.results) {
      console.log(`[boot] ${result.service_id} ${result.state} attempts=${result.attempts} http=${result.http_status ?? "-"} ${result.reason}`);
    }
    console.log(`[boot] READY=${report.ready} FAILED_LOCKED=${report.failed_locked} SKIPPED=${report.skipped}`);
  })
  .catch((error) => {
    console.log(`[boot] dependency-ordered boot failed: ${error instanceof Error ? error.message : String(error)} — sweep ปกติยังทำงานต่อ`);
  });

const handle = startRecoverySupervisor({
  services,
  intervalMs,
  onCycle: (cycle) => {
    acted.push(cycle);
    // One line per real action, to the launchd log. Ids, not prose.
    console.log(`[recovery] condition=${cycle.condition_id} service=${cycle.service_id} ${cycle.initial_condition} -> ${cycle.final_condition} action=${String(cycle.action)} attempt=${cycle.attempt} resumed=${cycle.resumed_work_ids.length}/${cycle.waiting_before.length}`);
  },
});

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  const body = {
    ok: true,
    service_id: SELF_SERVICE_ID,
    pid: process.pid,
    started_at: startedAt,
    interval_ms: intervalMs,
    watching: services,
    ticks: handle.ticks(),
    last_tick_at: handle.lastTickAt(),
    // Only what this PROCESS has done since it started. The system's full
    // history lives in the evidence store, never in this process's memory.
    actions_this_process: acted.length,
  };
  if (url === "/health" || url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(url === "/status" ? { ...body, cycles: acted.map((c) => ({ condition_id: c.condition_id, service_id: c.service_id, action_id: c.action_id, attempt: c.attempt, final: c.final_condition, resumed: c.resumed_work_ids })) } : body));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.listen(port, "127.0.0.1");
console.log(`recovery-supervisor pid=${process.pid} listening on 127.0.0.1:${port}; watching ${services.join(", ")} every ${intervalMs}ms`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    handle.stop();
    try { server.close(); } catch { /* already closing */ }
    process.exit(0);
  });
}
