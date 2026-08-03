// Task Stage Tracer CLI (owner, 2026-08-04): "สร้างเครื่องมือ...ตรวจสอบ
// คำสั่งของตัวเอง...มนุษย์จะได้รู้ว่าระบบไปถึงไฟล์หรือโค้ดตัวไหนแล้ว" — reads
// the real trace ai-task-watcher.mjs writes to ai_tasks.trace (migration
// 20260804000003) and prints it as a human-readable timeline, so a task
// that never came back shows exactly which real stage it's stuck at
// (queued but never dequeued? pod never came up? Ollama request sent but
// no response? callback posted but ai-callback itself failed?) instead of
// just "pending" with no further information.
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const PROJECT_DIR = "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /dna-os-deadboard";

function loadEnv() {
  return Object.fromEntries(
    readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
      .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
  );
}

const STAGE_LABEL = {
  dequeued: "หยิบงานจากคิว",
  ollama_request_sent: "ส่งคำสั่งไป Ollama",
  ollama_response_received: "Ollama ตอบกลับแล้ว",
  ollama_request_failed: "Ollama ไม่ตอบ/error",
  callback_posting: "ส่งผลไป ai-callback",
  callback_posted: "ai-callback รับแล้ว",
  callback_failed: "ai-callback ไม่ตอบ/error",
  done: "เสร็จสมบูรณ์",
  failed: "ล้มเหลว",
};

async function traceTask(taskId) {
  const env = loadEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: task, error } = await db.from("ai_tasks").select("*").eq("id", taskId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!task) return { found: false };

  const trace = task.trace ?? [];
  console.log(`\nงาน: ${task.kind} (${task.id})`);
  console.log(`สถานะปัจจุบัน: ${task.status}${task.error ? ` — ${task.error}` : ""}`);
  console.log(`สร้างเมื่อ: ${task.created_at}\n`);

  if (trace.length === 0) {
    console.log("ยังไม่มี trace เลย — งานนี้ยังไม่เคยถูกหยิบไปประมวลผล (ยังค้างอยู่ในคิว 'pending')");
    return { found: true, stuckAt: "never_dequeued" };
  }

  console.log("ลำดับเหตุการณ์จริง:");
  trace.forEach((t, i) => {
    const label = STAGE_LABEL[t.stage] ?? t.stage;
    console.log(`  ${i + 1}. [${t.at}] ${label}${t.detail ? ` — ${t.detail}` : ""}`);
  });

  const last = trace[trace.length - 1];
  const terminal = ["done", "failed", "ollama_request_failed", "callback_failed"];
  if (!terminal.includes(last.stage)) {
    console.log(`\n⚠️  ค้างอยู่ที่ขั้นตอน "${STAGE_LABEL[last.stage] ?? last.stage}" — ยังไม่ไปต่อ`);
    return { found: true, stuckAt: last.stage };
  }
  return { found: true, stuckAt: null };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const taskId = process.argv[2];
  if (!taskId) {
    console.error("ใช้งาน: node trace-task.mjs <ai_tasks.id>");
    process.exit(1);
  }
  traceTask(taskId)
    .then((r) => { if (!r.found) { console.error("ไม่พบงานนี้"); process.exit(1); } })
    .catch((e) => { console.error(e.message); process.exit(1); });
}

export { traceTask };
