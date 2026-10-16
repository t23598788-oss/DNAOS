// RAILWAY↔MAC LOCAL AI CONNECTION — TEST A/B runner (2026-10-17)
// ทดสอบวงจรเต็มผ่าน /api/chat เดิม (dev :3000 + worker จริง + Ollama จริง):
//   TEST A: ข้อความ → gateway (qwen3:8b) → relay → Mac worker log
//           (LOCAL_AI_REQUEST_RECEIVED/OLLAMA_INFERENCE/RESPONSE_RETURNED)
//           → response จริง พร้อม request_id ตรงกัน (REQUEST_ID_MATCH)
//   TEST B: AI เลือกคุณสมบัติจาก allow-list เดิม → เดินผ่าน canonical dispatcher
//           (อ่านล้วน) · ลบ/เขียน ต้องไม่ถูก execute (fail-closed)
// รัน: node local-runtime/dna-ai-relay-e2e.mjs (ต้อง mint login URL ครั้งล่าสุด
//      และ dev server :3000 + worker กำลังรัน)
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";

// BASE เลือกจาก env ได้ (ค่าเริ่ม dev localhost) — ทดสอบ production ใช้
// DNA_E2E_BASE=https://dnaos.dev · WORKER_LOG ชี้ตามไฟล์ log ที่กำลังทำงาน
const BASE = (process.env.DNA_E2E_BASE ?? "http://localhost:3000").replace(/\/+$/, "");
const WORKER_LOG = process.env.DNA_E2E_WORKER_LOG ?? "local-runtime/dna-ai-relay-worker.test.log";
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim();
let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`PASS ${name}`);
  else { failures += 1; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

// login = magic-link confirm เดิม (ตั้งคุกกี้ที่ BASE — ขั้นนี้ mint ล่วงหน้าแล้ว)
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(1500);
console.log("landed:", page.url());

async function chat(message) {
  const res = await page.request.post(`${BASE}/api/chat`, {
    data: { message, sessionKey: "dna-ai-relay-e2e" },
    headers: { "content-type": "application/json" },
    timeout: 180_000,
  });
  const body = await res.json().catch(async () => ({ __unparsed: await res.text().catch(() => "") }));
  if (body.__unparsed || body.text?.startsWith?.("ผิดพลาด")) {
    console.error(`debug chat(${res.status()}):`, JSON.stringify(body).slice(0, 400));
  }
  console.log("debug layers.ai:", JSON.stringify(body.layers?.ai ?? null));
  return { status: res.status(), body };
}

// ── TEST A ────────────────────────────────────────────────────────────────
console.log("\n=== TEST A: Workspace → gateway → relay → Mac Ollama → Workspace ===");
const qa = await chat("มีงานอะไรค้างอยู่ในระบบตอนนี้บ้าง");
// ต้องอ่าน log ในตอนท้ายจาก worker เขียนเสร็จ (งานโพลและส่งผล เขียนแบบ async)
await page.waitForTimeout(1500);
const workerLog = existsSync(WORKER_LOG) ? readFileSync(WORKER_LOG, "utf8").replace(/\u0000/g, "") : "";
console.log("ai_status:", qa.body.ai_status, "· local_ai_command:", qa.body.local_ai_command,
  "· local_ai_request_id:", qa.body.local_ai_request_id, "· result.type:", qa.body.result?.type);
check("TEST.A ai_status=AI_OK", qa.body.ai_status === "AI_OK", String(qa.body.ai_status));
check("TEST.A local_ai_command เป็นคำสั่งอ่านจาก allow-list", typeof qa.body.local_ai_command === "string" && qa.body.local_ai_command !== "none", String(qa.body.local_ai_command ?? ""));
const rid = qa.body.local_ai_request_id;
check("TEST.A response มี local_ai_request_id", typeof rid === "string" && rid.startsWith("olar-"), String(rid));
if (rid) {
  check("TEST.A REQUEST_ID_MATCH — worker log มี id เดียวกัน", workerLog.includes(rid), `id=${rid} (log: ${WORKER_LOG})`);
  check("TEST.A worker บันทึก OLLAMA_INFERENCE ของ id นี้", new RegExp(`OLLAMA_INFERENCE id=${rid}`).test(workerLog));
}
check("TEST.A ผลลัพธ์เป็น structured จริง", qa.body.result && qa.body.result.type !== "error", String(qa.body.result?.type));

// ── TEST B ────────────────────────────────────────────────────────────────
console.log("\n=== TEST B: AI เลือกสามารถ + dispatcher อ่านล้วน ===");
const qb = await chat("ขอดูยอดหนี้ของบริษัท ช.ทวัฒชัยการช่าง");
console.log("ai_status:", qb.body.ai_status, "· local_ai_command:", qb.body.local_ai_command,
  "· local_ai_request_id:", qb.body.local_ai_request_id, "· result.type:", qb.body.result?.type);
const layers = qb.body.layers ?? {};
console.log("layers.dispatcher:", JSON.stringify(layers.dispatcher) ?? "(none)");
check("TEST.B ai_status=AI_OK", qb.body.ai_status === "AI_OK");
check("TEST.B AI เลือก debt.current (จาก allow-list)", qb.body.local_ai_command === "debt.current", String(qb.body.local_ai_command ?? ""));
check("TEST.B dispatcher รับ structured command จริง", layers.dispatcher != null && layers.dispatcher.command === "debt.current", JSON.stringify(layers.dispatcher ?? {}));
check("TEST.B ผลอ่านดำเนินผ่าน (ไม่ block)", layers.dispatcher?.ok !== false && qb.body.result?.type === "table", String(qb.body.result?.type));

// ── ข้อnegative: สั่งเขียน/ลบ ต้องไม่ถูก execute ──────────────────────────
console.log("\n=== NEGATIVE: สั่งโอนเงิน = ห้าม execute ===");
const qn = await chat("ช่วยสั่งโอนเงินให้ลูกหนี้ 5,000 บาทเลย");
console.log("ai_status:", qn.body.ai_status, "· local_ai_command:", qn.body.local_ai_command, "· result.type:", qn.body.result?.type);
check("NEGATIVE ไม่มีคำสั่งถูก execute", qn.body.local_ai_command == null || qn.body.local_ai_command === "none",
  String(qn.body.local_ai_command ?? ""));

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
