// Storage Intelligence — threshold watcher (owner spec, 2026-08-04:
// "ตรวจทุก 6 ชั่วโมง หากพื้นที่ว่างต่ำกว่า 150GB ให้สร้าง event และรายงาน
// ห้ามย้ายไฟล์อัตโนมัติ ห้ามลบไฟล์อัตโนมัติ"). Runs via a macOS LaunchAgent
// (com.dnaos.storage-threshold-watcher.plist), same pattern as
// ai-task-watcher.mjs/print-watcher.mjs/watch-drive.mjs. Calls the SAME
// engine code the admin UI/API route use (engines/storage/engine.ts) — not
// a parallel decision system — so there is exactly one place that decides
// what free space and what's reclaimable actually mean.
import { readFileSync } from "fs";
import { join } from "path";
import { hostname } from "os";
import { createClient } from "@supabase/supabase-js";
import { checkThreshold, scanStorage, classifyScan, report } from "@/engines/storage/engine";
import { detectArchitectureDrift } from "@/engines/workspace/architectureDriftDetector";
import { fileURLToPath } from "url";
import { dirname } from "path";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const env = Object.fromEntries(
  readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ALERT_URL = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/storage-threshold-alert`;
const DRIFT_ALERT_URL = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/architecture-drift-alert`;

// Development Machine Policy (Constitution Rule 117, owner 2026-08-04):
// "หากตรวจพบ Local AI Runtime หรือ Local Model ให้แจ้งเตือนเป็น
// Architecture Drift". Piggybacks on this watcher's existing 6h cadence
// rather than a second LaunchAgent — one schedule, two real checks.
async function checkArchitectureDrift() {
  const report = detectArchitectureDrift({ localRuntimeDir: join(PROJECT_DIR, "local-runtime") });
  console.log(`[storage-threshold-watcher] architecture drift: clean=${report.clean} findings=${report.findings.length}`);

  await db.from("architecture_drift_events").insert({
    machine_id: hostname(),
    clean: report.clean,
    finding_count: report.findings.length,
    findings: report.findings,
  });

  if (!report.clean) {
    await fetch(DRIFT_ALERT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DNA-Internal-Secret": env.AI_CALLBACK_SECRET },
      body: JSON.stringify({ findings: report.findings }),
    }).catch((e) => console.error("[storage-threshold-watcher] drift alert push failed:", e.message));
  }
}

async function main() {
  // Real reclaimable figure, not just a free-space number — run a fresh
  // scan+classify so the alert can say how much SAFE space actually exists.
  let reclaimableBytes = null;
  try {
    const { scanRunId } = await scanStorage(db, "scheduler");
    await classifyScan(db, scanRunId, "scheduler");
    const rep = await report(db, scanRunId);
    reclaimableBytes = rep.total_safe_bytes;
  } catch (e) {
    console.error("[storage-threshold-watcher] scan/classify failed, reporting free-space only:", e instanceof Error ? e.message : e);
  }

  const { freeBytes, breached } = await checkThreshold(db, "scheduler", reclaimableBytes);
  console.log(`[storage-threshold-watcher] free=${(freeBytes / 1e9).toFixed(1)}GB breached=${breached} reclaimable=${reclaimableBytes != null ? (reclaimableBytes / 1e9).toFixed(1) + "GB" : "unknown"}`);

  if (breached) {
    await fetch(ALERT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DNA-Internal-Secret": env.AI_CALLBACK_SECRET },
      body: JSON.stringify({ freeBytes, thresholdBytes: 150 * 1e9, reclaimableBytes }),
    }).catch((e) => console.error("[storage-threshold-watcher] alert push failed:", e.message));
  }

  await checkArchitectureDrift();
}

main().catch((e) => {
  console.error("[storage-threshold-watcher] fatal:", e);
  process.exit(1);
});
