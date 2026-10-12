// DNA OS Railway-native Cline worker (DNA-000218, RAILWAY NATIVE CLINE RUNTIME).
// Runs on a SEPARATE Railway Linux service. Contract reuse ONLY:
//   - polls public.ai_tasks (kind='owner_cline_command', status='pending')
//   - atomic claim (pending -> processing WHERE status='pending' RETURNING)
//     = duplicate-execution protection
//   - executes Cline CLI headless (provider=cline account, deepseek — NOT OpenAI)
//     behind a 127.0.0.1 auth proxy: the task-bound owner session cookie is
//     injected SERVER-SIDE and never appears in prompts, argv or logs
//   - calls the Business Core business.dispatch through the proxy (READ
//     whitelist enforced there — this worker holds NO business authority)
//   - posts the result to the EXISTING ai-callback edge function
//     (x-callback-secret, same as the Mac ai-task-watcher) which writes
//     ai_tasks.result/status — no LINE push for owner tasks
//   - clears session_cookie from the task row right after callback
// Timeouts: task expires_at guard + hard CLINE_TIMEOUT_SECONDS+20s kill.
import { createClient } from "@supabase/supabase-js";
import { spawn, spawnSync } from "node:child_process";

// boot self-bootstrap (DNA-000219 verified defect: prod tasks 181afc26/04840bf5
// failed with spawn cline ENOENT — Railway build ไม่รัน nixpacks install phase)
// → ติดตั้ง cline CLI ตอนเริ่ม daemon (ครั้งเดียวต่อ container life)
function ensureClineCli() {
  const probe = spawnSync("cline", ["--version"], { stdio: "ignore" });
  if (probe.status === 0) return;
  console.log("[cline-worker] cline CLI missing at boot — installing...");
  const r = spawnSync("npm", ["install", "-g", "cline@3.0.62"], { stdio: "inherit" });
  if (r.status !== 0) console.error("[cline-worker] cline install failed — tasks will fail until resolved");
}
ensureClineCli();
import { createServer as createProxyServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CALLBACK_SECRET = process.env.AI_CALLBACK_SECRET;
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/ai-callback`;
const DEADBOARD_URL = (process.env.DEADBOARD_URL || "https://dna-os-deadboard-production.up.railway.app").replace(/\/$/, "");
const CLINE_TIMEOUT_SECONDS = Number(process.env.CLINE_TIMEOUT_SECONDS ?? 180);
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 8000);
const WORKER_ID = process.env.WORKER_ID || "railway-cline-worker-1";
const CLAIM_WHERE = "owner_cline_command";

if (!SUPABASE_URL || !SERVICE_KEY || !CALLBACK_SECRET) {
  console.error("[cline-worker] FATAL: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / AI_CALLBACK_SECRET");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Seed Cline account auth once per boot from env (providers.json content).
// The CLI refreshes and rewrites the file itself on expiry (container FS).
function seedClineAuth() {
  const seed = process.env.CLINE_SEED_PROVIDERS_JSON;
  const dataDir = join(homedir(), ".cline", "data");
  mkdirSync(join(dataDir, "settings"), { recursive: true });
  if (seed) {
    const file = join(dataDir, "settings", "providers.json");
    writeFileSync(file, seed, { mode: 0o600 });
    chmodSync(file, 0o600);
    console.log("[cline-worker] cline auth seeded from env");
  }
}
seedClineAuth();

function resolveClineBin() {
  return process.env.CLINE_BIN && existsSync(process.env.CLINE_BIN) ? process.env.CLINE_BIN : "cline";
}

const CLINE_BIN = resolveClineBin();

// ── one authorized dispatch proxy per task ─────────────────────────────────
// allow-list mirrors the DNA OS business.dispatch surface (manifest tool).
// Cookie injected here, server-side — never in argv/prompt/log.
function startTaskProxy(cookie) {
  const origin = new URL(DEADBOARD_URL);
  const proxy = createProxyServer((req, res) => {
    const url = req.url ?? "";
    const allowed =
      url === "/api/v1/mcp/manifest" ||
      url.startsWith("/api/v1/mcp/business/dispatch");
    if (!allowed || (req.method !== "GET" && req.method !== "POST")) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "PROXY_PATH_NOT_ALLOWED" }));
      return;
    }
    const headers = { "content-type": "application/json", cookie: cookie || "" };
    const mod = origin.protocol === "https:" ? httpsRequest : httpRequest;
    const up = mod(
      { hostname: origin.hostname, port: origin.port || (origin.protocol === "https:" ? 443 : 80), path: url, method: req.method, headers },
      (ur) => { res.writeHead(ur.statusCode ?? 502, { "content-type": "application/json" }); ur.pipe(res); },
    );
    up.on("error", () => { res.writeHead(502, {"content-type":"application/json"}); res.end(JSON.stringify({ ok: false, error: "PROXY_UPSTREAM_ERROR" })); });
    req.pipe(up);
  });
  return new Promise((resolvePort) => {
    proxy.once("error", () => resolvePort(null));
    proxy.listen(0, "127.0.0.1", () => {
      const addr = proxy.address();
      resolvePort(typeof addr === "object" && addr ? { proxy, port: addr.port } : null);
    });
  });
}

// ── Cline execution (same documented CLI quirks as the Mac worker) ─────────
// ── DNA-000223 MINIMAL AI COMMAND INTERPRETATION ─────────────────────────────
// บทของ AI (Cline/deepseek เดิม ไม่มี runtime ใหม่): แปลภาษาคนเป็น
// {command, payload} เท่านั้น — ข้อมูลธุรกิจจริง/คำนวณ/จัดรูปผล ทั้งหมดอยู่
// ฝั่ง DNA OS — canonical data ไม่เข้า prompt โมเดล (มีแค่ข้อความ+ชื่อคู่ค้า)
const ALLOWED_COMMANDS = new Set([
  "partner.find", "partner.list", "partner.profile", "partner.timeline",
  "document.list", "document.boq", "document.po", "document.do", "document.receipt",
  "invoice.list", "invoice.latest", "invoice.find", "invoice.items",
  "debt.list", "debt.all", "debt.current", "debt.trackings",
  "draft.list", "job.list", "job.active", "document.preview",
  "invoice.payments", "expense.list", "bank.statement", "receipt.list", "receipt.latest", "receipt.get", "weather.forecast", "fuel.prices", "transport.estimate", "material.sources",
]);

// DNA-000231: AI-readable capability projection — derive จาก verified command
// contracts ของ command-registry + dispatcher (ไม่สร้าง truth ใหม่: ถ้า metadata
// หายไป ให้ดูที่ registry/dispatcher เป็นหลัก)
const PROJECTIONS = {
  "partner.find": { desc: "ค้นคู่ค้า/บริษัท/บุคคลด้วย keyword (ทนช่องว่าง)", in: ["keyword"], out: "match list", filters: ["keyword(ส่วนหนึ่งของชื่อ)"], auth: "owner-session" },
  "partner.list": { desc: "รายการคู่ค้าทั้งหมดพร้อมสรุปเอกสาร", in: [], out: "list", filters: [], auth: "owner-session" },
  "partner.profile": { desc: "โปรไฟล์คู่ค้า (ต้องมี partner_id)", in: ["partner_id"], out: "profile fields", filters: [], auth: "owner-session" },
  "partner.timeline": { desc: "ประวัธิธุรกิจ/เอกสารของคู่ค้า (ต้องมี partner_id)", in: ["partner_id"], out: "timeline items", filters: [], auth: "owner-session" },
  "document.list": { desc: "รายการเอกสารทั้งหมด (บิล/ใบสั่งซื้อ/ใบส่งของ...)", in: [], out: "table", filters: [], auth: "owner-session" },
  "invoice.list": { desc: "รายการใบแจ้งหนี้", in: [], out: "table", filters: [], auth: "owner-session" },
  "invoice.latest": { desc: "ใบแจ้งหนี้ล่าสุด (มี id สำหรับ preview)", in: [], out: "invoice", filters: [], auth: "owner-session" },
  "invoice.items": { desc: "รายการสินค้าในใบแจ้งหนี้ (ต้องมี partner_id)", in: ["partner_id"], out: "items", filters: [], auth: "owner-session" },
  "invoice.payments": { desc: "การจัดสรรชำระเงินต่อใบแจ้งหนี้", in: ["document_id?"], out: "allocations", filters: [], auth: "owner-session" },
  "debt.list": { desc: "ลูกหนี้ที่ค้าง (รายการเปิด)", in: [], out: "table", filters: [], auth: "owner-session" },
  "debt.all": { desc: "หนี้ค้างชำระทั้งหมด", in: [], out: "summary/table", filters: [], auth: "owner-session" },
  "debt.current": { desc: "ยอดหนี้ปัจจุบันของคู่ค้า (ต้องมี partner_id)", in: ["partner_id"], out: "debt", filters: [], auth: "owner-session" },
  "draft.list": { desc: "เอกสารร่างที่รอ", in: [], out: "list", filters: [], auth: "owner-session" },
  "job.list": { desc: "งาน/ไซต์งานทั้งหมด", in: [], out: "table", filters: [], auth: "owner-session" },
  "job.active": { desc: "งานที่กำลังทำ", in: [], out: "table", filters: [], auth: "owner-session" },
  "material.list": { desc: "ประเภทวัสดุ", in: [], out: "list", filters: [], auth: "owner-session" },
  "expense.list": { desc: "รายจ่ายบริษัท", in: [], out: "table", filters: [], auth: "owner-session" },
  "bank.statement": { desc: "รายการสลิป/Statement ธนาคาร", in: [], out: "table", filters: [], auth: "owner-session" },
  "receipt.list": { desc: "หลักฐานรับเงินทั้งหมด (กรอง verification ได้)", in: ["verification(all|verified|unverified)?", "limit?", "offset?"], out: "table+total", filters: ["verification"], auth: "owner-session" },
  "receipt.latest": { desc: "หลักฐานรับเงินล่าสุด", in: [], out: "sections", filters: [], auth: "owner-session" },
  "receipt.get": { desc: "รายละเอียดหลักฐานรับเงิน (ต้องมี receipt_id หรือระบบ resolve จากบริบท)", in: ["receipt_id?"], out: "sections", filters: [], auth: "owner-session" },
  "document.preview": { desc: "เปิดเอกสารต้นฉบับ/canonical preview (ต้องมี document_id + document_kind)", in: ["document_id", "document_kind"], out: "file|document", filters: [], auth: "owner-session" },
};
// ข้อจำกัดที่ยังไม่มีคำสั่งในบัญชี (engines มีบางส่วนแต่ไม่ได้ register เป็น command) — ห้ามอ้างว่ามี
Object.assign(PROJECTIONS, {
  "weather.forecast": { desc: "พยากรณ์อากาศตามสถานที่/พิกัด (Open-Meteo)", in: ["location?", "lat?", "lng?", "day_offset?"], out: "forecast", filters: ["location|coords", "day_offset"], auth: "owner-session" },
  "fuel.prices": { desc: "ราคาเชื้อเพลิงสด (Bangchak)", in: [], out: "prices", filters: [], auth: "owner-session" },
  "transport.estimate": { desc: "ระยะทาง/เวลาเดินทาง/ค่าน้ำมันระหว่าง 2 พิกัด", in: ["from_lat", "from_lng", "to_lat", "to_lng", "trips?"], out: "estimate", filters: [], auth: "owner-session" },
  "material.sources": { desc: "แหล่งวัสดุใกล้พิกัดหน้างาน (ต้องมี lat/lng)", in: ["lat", "lng", "material_type_id?"], out: "nearest", filters: [], auth: "owner-session" },
});
const KNOWN_GAPS = ["พายุบนเส้นทางขนส่งแบบจับคู่เส้นทางจริง", "ตารางรถ/เวลาออก-ถึงจริงต่อคัน (SLA ส่งมอบ)", "ราคาตลาดน้ำมันที่ไม่ใช่แบรนด์ที่เชื่อมต่อ", "ค้นบริษัทหลายเงื่อนไขพร้อมกัน (type/พื้นที่) แบบ advanced"];

function interpreterPrompt(who) {
  return `คุณคือตัวแปลคำสั่งของ DNA OS — แปลคำสั่งภาษาคนเป็น JSON เท่านั้น ห้ามแต่งข้อมูลธุรกิจใด ๆ (คุณไม่มีข้อมูลและห้ามเดา)
${who ? `บริบท: กำลังคุยกับคู่ค้า "${who}" — ถ้าคำสั่งบอกว่า "ของบริษัทนี้/ของคู่ค้านี้" ให้ใช้คู่ค้าชื่อนี้` : ""}
คำสั่งที่แปลได้ (ใช้ชื่อนี้เป๊ะ): ${[...ALLOWED_COMMANDS].join(", ")}
รูปผล: {"command":"<ชื่อคำสั่ง>","payload":{...},"ask":null} — payload ที่ใช้บ่อย: partner_id, keyword, document_id, document_kind ("invoice"|"standalone_document")
กติกา: ถ้าคำสั่งมีชื่อบริษัท/คู่ค้า/คน ให้ใส่ชื่อนั้น (ตัดคำลงท้าย เช่น ครับ/ค่ะ ออก) ใน payload.keyword เสมอ — ห้ามถามเรื่องชื่อซ้ำ ระบบจะแปลงชื่อเป็นรหัสให้เอง
ตัวอย่าง: "ดึงเอกสารล่าสุดของบริษัท ช.ธวัชชัยการช่าง" → {"command":"document.list","payload":{"keyword":"ช.ธวัชชัยการช่าง"},"ask":null}
ตัวอย่าง: "แสดงเอกสารต้นฉบับของบริษัทนี้" (มีบริบทคู่ค้า) → {"command":"document.preview","payload":{},"ask":null}
ตัวอย่าง: "ดูรายจ่ายบริษัท" → {"command":"expense.list","payload":{},"ask":null}
ตัวอย่างคำภาษาคน (AI เลือกคำสั่งที่เหมาะที่สุดจากบัญชี):
"บริษัทไหนค้างเงิน" หรือ "ลูกหนี้ทั้งหมด" → {"command":"debt.all","payload":{},"ask":null}
"ใครเคยซื้อทรายจากเรา" หรือ "ลูกค้าที่ซื้อวัสดุ" → {"command":"partner.list","payload":{},"ask":null}
"หาเบอร์โทร ช.ธวัชชัย" หรือ "ข้อมูลติดต่อ ธวัชชัย" → {"command":"partner.find","payload":{"keyword":"ธวัชชัย"},"ask":null}
"หาโรงงานคอนกรีตแถวขอนแก่น" → {"command":"partner.find","payload":{"keyword":"คอนกรีต"},"ask":null} (ใส่คำสำคัญของสิ่งที่หา ตัดคำทั่วไปเช่น แถว/ใกล้/ย่าน ออก)
"โรงโม่หินใกล้หน้างาน" → {"command":"partner.find","payload":{"keyword":"โรงโม่"},"ask":null}
กติกา receipt: payload.verification ใช้ได้เฉพาะ "verified" | "unverified" | "all" เท่านั้น (ห้ามใช้คำอื่น เช่น confirmed)
ตัวอย่าง: "แสดงรายการรับเงินที่ยืนยันแล้ว" → {"command":"receipt.list","payload":{"verification":"verified"},"ask":null}
ตัวอย่าง: "แสดงรายการรับเงินที่ยังไม่ยืนยัน" → {"command":"receipt.list","payload":{"verification":"unverified"},"ask":null}
ตัวอย่าง: "แสดงหลักฐานรับเงินทั้งหมด" → {"command":"receipt.list","payload":{},"ask":null}
ตัวอย่าง: "เปิดรายละเอียดหลักฐานล่าสุด" หรือ "เปิดรายละเอียดหลักฐานหนึ่งรายการ" → {"command":"receipt.get","payload":{},"ask":null} (ระบบจะ resolve ให้เองจากบริบท)
ask ใช้เฉพาะเมื่อไม่มีชื่อและบริบทก็ว่างจริง ๆ · ตอบ JSON เท่านั้น ส่วนแผน (PLAN JSON): {"plan":{"steps":[{"command":"...","payload":{}}],"conditions":["เงื่อนไขที่สกัดได้ทั้งหมด"],"uncovered":["เงื่อนไขที่ไม่มีเครื่องมือรองรับ"]},"ask":null,"command":null,"payload":null}
กติกาแผน: สกัดเงื่อนไขครบ (ชนิด-entity/ประเภทธุรกิจ/สถานที่/เวลา/วัสดุ/ความสัมพันธ์/เงื่อนไขธุรกิจ/ผลที่ต้องการ) — ห้ามทิ้ง filter เงียบ ๆ · เทียบกับ PROJECTIONS/KNOWN_GAPS: ถ้าเงื่อนไขหลักไม่มีเครื่องมือรองรับ (เช่นสภาพอากาศนอกขอนแก่น/พายุ/ระยะทาง/ราคาน้ำมันตลาด/ตารางรถ) → ใส่ uncovered แล้วตั้ง command:null พร้อม ask บอกตรง ๆ ว่าระบบยังไม่มีส่วนนั้น (ห้ามตอบผ่านโดยทิ้งเงื่อนไข) · steps สูงสุด2 เป็น dependent read ที่ระบบรองรับเท่านั้น (partner.find→partner_id / invoice.latest→document_id) · ถ้ามี plan ให้ใส่ command/payload = step แรกด้วย (compat) · ตอบ JSON เท่านั้น`;
}

// spawn เดิมทุกอย่าง (quirks: prompt แรก+trailing space, detached process group kill)
function runCline(message, who) {
  return new Promise((resolve) => {
    // DNA-000225: ใช้ cline-pass (สมาชิก/subscription ของบัญชี owner — เดียวกับ
    // ที่ extension VS Code ใช้อยู่) แทน cline Credits ที่หมด — ไม่ต้องเติมเครดิต
    const args = [`${message.trim().slice(0, 2000)} `, "--provider", "cline-pass", "--json", "--auto-approve", "true",
      "-t", String(CLINE_TIMEOUT_SECONDS), "-s", interpreterPrompt(who)];
    let out = "";
    const child = spawn(CLINE_BIN, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env }, detached: true });
    const killer = setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
    }, (CLINE_TIMEOUT_SECONDS + 20) * 1000);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.on("error", (e) => { clearTimeout(killer); resolve({ error: `spawn: ${e.message}` }); });
    child.on("close", () => {
      clearTimeout(killer);
      let text = null, usage = null, durationMs = 0, iterations = null;
      for (const line of out.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const m = JSON.parse(line);
          if (m.type === "run_result") {
            if (typeof m.text === "string") text = m.text;
            usage = m.usage ?? usage; durationMs = m.durationMs ?? durationMs; iterations = m.iterations ?? iterations;
          }
        } catch { /* partial */ }
      }
      if (!text) return resolve({ error: "no run_result (timeout or crash)", raw: text || "" });
      const cleaned = text.replace(/```(?:json)?\s*/gi, "").trim();
      const st = cleaned.indexOf("{"), en = cleaned.lastIndexOf("}");
      let parsed = null;
      try { parsed = JSON.parse(cleaned.slice(st, en + 1)); } catch { parsed = null; }
      resolve({ parsed, usage, durationMs, iterations, raw: text });
    });
  });
}

async function postCallback(taskId, payload) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(CALLBACK_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-callback-secret": CALLBACK_SECRET },
        body: JSON.stringify({ taskId, kind: CLAIM_WHERE, ...payload }),
      });
      if (res.ok) return true;
      console.error(`[cline-worker] callback attempt ${attempt} -> HTTP ${res.status}`);
    } catch (e) {
      console.error(`[cline-worker] callback attempt ${attempt} error: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return false;
}

// DNA OS เรียกข้อมูลเอง — ผ่าน proxy allow-list เดิม (cookie ไม่แตะ prompt)
async function dispatchVia(cookie, command, payload) {
  const prox = await startTaskProxy(cookie);
  if (!prox) throw new Error("proxy start failed");
  try {
    const res = await fetch(`http://127.0.0.1:${prox.port}/api/v1/mcp/business/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command, payload }),
    });
    return await res.json();
  } finally {
    try { prox.proxy.close(); } catch { /* closed */ }
  }
}

// จัดรูปผลฝั่ง DNA OS ด้วย ChatResult contract เดิมของ Workspace (ไม่ใช่งาน AI)
function tableOf(title, columns, rows) {
  return { type: "table", title, table: { columns: columns.map((c, i) => ({ key: "c" + i, label: c })), rows } };
}
function formatResult(command, data) {
  if (!data || typeof data !== "object") return null;
  if (command === "document.preview") {
    if (data.mode === "file") return { type: "file", name: String(data.document_number ?? "ไฟล์"), path: String(data.storage_path), mime: String(data.mime_type ?? "application/octet-stream"), size: Number(data.size_bytes ?? 0) };
    if (data.mode === "summary") return { type: "document", title: `ตัวอย่างเอกสาร ${data.document_number ?? ""} (canonical preview ไม่ใช่ไฟล์ต้นฉบับ)`, html: String(data.summary_html ?? "") };
    return null;
  }
  if (command === "partner.timeline" && Array.isArray(data.timeline)) {
    return { type: "timeline", title: "ประวัติการค้าขาย", summary: null, items: data.timeline.slice(0, 50).map((t) => ({ date: String(t.date ?? "-"), kind: "document", template_id: "generic", template_key: "generic", event_type: String(t.event_type ?? "info"), title: String(t.title ?? "-"), subtitle: null, amount: typeof t.amount === "number" ? t.amount : null, status: t.status ? String(t.status) : null })) };
  }
  if (command === "partner.profile") {
    const fields = [];
    const pairs = [["ประเภท", data.partner_type_label], ["โทรศัพท์", data.phone], ["ที่อยู่", data.address], ["ผู้ติดต่อ", data.contact_name]];
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i][1]) fields.push({ kind: "field", id: "f" + i, label: pairs[i][0], value: String(pairs[i][1]) });
    }
    const block = { kind: "fields", id: "company", title: String(data.name || "ข้อมูลคู่ค้า"), fields: fields };
    return { type: "sections", blocks: [block] };
  }
  // DNA-000226: หลักฐานรับเงิน — ทุกสถานะพร้อมธง verification
  function receiptSections(r, titlePrefix) {
    const fields = [];
    const pairs = [
      ["วันที่", r.transaction_datetime ?? r.document_date],
      ["ผู้ส่ง/ผู้ขาย", r.sender_name ?? r.vendor_name],
      ["ยอด", r.amount],
      ["ประเภทเอกสาร", r.document_type],
      ["สถานะ", r.status],
      ["ระดับตรวจสอบ", r.verification_level],
      ["ยืนยันการชำระ", r.payment_verified ? "ยืนยันแล้ว" : "ยังไม่ยืนยัน"],
      ["เลขอ้างอิง", r.reference_number],
      ["บริษัท", r.partner_name],
      ["ไฟล์ต้นฉบับ", r.media_mime_type],
    ];
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i][1]) fields.push({ kind: "field", id: "f" + i, label: pairs[i][0], value: String(pairs[i][1]) });
    }
    const block = { kind: "fields", id: "receipt", title: titlePrefix + (r.payment_verified ? " (ยืนยันแล้ว)" : " (ยังไม่ยืนยัน)"), fields: fields };
    return { type: "sections", blocks: [block] };
  }
  if (command === "receipt.latest" && data.receipt) return receiptSections(data.receipt, "หลักฐานรับเงินล่าสุด");
  if (command === "receipt.get" && data.receipt) return receiptSections(data.receipt, "รายละเอียดหลักฐาน");
  if (command === "receipt.list" && Array.isArray(data.receipts)) {
    const total = Number(data.total ?? data.receipts.length);
    const rows = data.receipts.slice(0, 50).map((r) => [r.transaction_datetime ?? r.document_date, r.sender_name ?? r.vendor_name, r.amount, r.payment_verified ? "ยืนยันแล้ว" : "ยังไม่ยืนยัน", r.status, r.document_type, r.partner_name ?? "-", r.reference_number ?? "-"].map((x) => (x === null || x === undefined ? "-" : String(x).slice(0, 50))));
    const pageNote = total > data.receipts.length ? `หน้าแรก ${data.receipts.length} จาก ${total} ฉบับทั้งหมด` : `${total} ฉบับทั้งหมด`;
    return tableOf(`หลักฐานรับเงิน — ${pageNote}`, ["วันที่", "ผู้ส่ง/ผู้ขาย", "ยอด", "ยืนยัน", "สถานะ", "ประเภท", "บริษัท", "เลขอ้างอิง"], rows);
  }
    let arr = Array.isArray(data) ? data : Object.values(data).find((v) => Array.isArray(v));
  if (!Array.isArray(arr)) {
    const fields = [];
    const entries = Object.entries(data).filter(([, v]) => v === null || typeof v !== "object").slice(0, 12);
    for (let i = 0; i < entries.length; i++) {
      fields.push({ kind: "field", id: "f" + i, label: String(entries[i][0]), value: String(entries[i][1]) });
    }
    if (fields.length) {
      const block = { kind: "fields", id: "summary", title: "สรุปข้อมูล", fields: fields };
      return { type: "sections", blocks: [block] };
    }
    return null;
  }
  if (["invoice.payments", "expense.list", "bank.statement"].includes(command)) {
    const cols = Object.keys(arr[0] ?? {}).filter((k) => typeof arr[0]?.[k] !== "object").slice(0, 8);
    return tableOf(`${command} (${arr.length})`, cols.map((c) => c.replace(/_/g, " ")), arr.slice(0, 50).map((r) => cols.map((c) => (r[c] === null || r[c] === undefined ? "-" : String(r[c]).slice(0, 60)))));
  }
  return tableOf(`${command} (${arr.length} รายการ)`,
    ["เลขที่เอกสาร/รหัส", "ประเภท", "วันที่", "ยอด", "สถานะ", "ชื่อ"],
    arr.slice(0, 50).map((r) => [r.document_number ?? r.invoice_no ?? r.id, r.document_type ?? r.type, r.document_date ?? r.created_at, r.net_amount ?? r.total_amount ?? r.amount, r.status ?? "-", r.party_name ?? r.name ?? "-"].map((x) => (x === null || x === undefined ? "-" : String(x).slice(0, 60)))));
}

async function executeTask(task) {
  const t0 = Date.now();
  const started = await db.from("ai_tasks")
    .update({ status: "processing", claimed_by: WORKER_ID, claimed_at: new Date().toISOString() })
    .eq("id", task.id).eq("status", "pending").select("id");
  if (!started.data?.length) return; // atomic claim = duplicate protection
  const who = task?.trace?.context?.who || null;
  try {
    let interp = await runCline(task.input_text || "", who);
    if (interp.error) throw new Error(interp.error);
    // DNA-000223B: แยก "คำตอบไม่ใช่ JSON" (เช่น โมเดล/เครดิตมีปัญหา) ออกจาก
    // "ถามจริง" — เดิม parse-fail ถูกปลอมเป็น ask → retry 1 ครั้ง แล้ว fail ชัดเจน
    if (!interp.parsed) {
      const rawHead = String(interp.raw ?? "");
      if (/insufficient balance|credit/i.test(rawHead)) throw new Error("INSUFFICIENT_CREDITS: cline provider credits exhausted");
      console.error(`[cline-worker] task ${task.id} interpreter non-JSON — retrying once`);
      interp = await runCline(`${task.input_text} (ตอบด้วย JSON เท่านั้น ห้ามมีข้อความอื่น)`, who);
      if (interp.error) throw new Error(interp.error);
      if (!interp.parsed) {
        if (/insufficient balance|credit/i.test(String(interp.raw ?? ""))) throw new Error("INSUFFICIENT_CREDITS: cline provider credits exhausted");
        throw new Error(`INTENT_UNKNOWN: non-JSON interpreter response`);
      }
    }
    const parsed = interp.parsed ?? {};
    const aiMs = Date.now() - t0;
    console.log(`[cline-worker] task ${task.id} interpreted (${aiMs}ms, tokens=${interp.usage?.totalOutputTokens ?? "?"}, cmd=${parsed.command ?? "ask"})`);
    const ask = typeof parsed.ask === "string" && parsed.ask ? parsed.ask : null;
    const command = typeof parsed.command === "string" ? parsed.command : null;
    if (ask || !command) {
      await db.from("ai_tasks").update({ session_cookie: null }).eq("id", task.id);
      const delivered = await postCallback(task.id, { result: { answer: "ขอรายละเอียดเพิ่มเติมครับ", result: null, ask, fail_reason: "ENTITY_AMBIGUOUS", worker: WORKER_ID, durationMs: Date.now() - t0, ai_tokens: interp.usage?.totalOutputTokens ?? null } });
      if (!delivered) throw new Error("callback delivery failed after 3 attempts");
      console.log(`[cline-worker] task ${task.id} done-ask (${Date.now() - t0}ms)`);
      return;
    }
    if (!ALLOWED_COMMANDS.has(command)) throw new Error(`CAPABILITY_UNAVAILABLE: ${command} ไม่อยู่ในชุดคำสั่งที่อนุญาต`);
    // DNA-000231: เงื่อนไขหลักที่ไม่มีเครื่องมือรองรับ → ห้ามตอบ SUCCESS โดยทิ้งเงื่อนไข
    const uncovered = parsed?.plan?.uncovered;
    if (Array.isArray(uncovered) && uncovered.length > 0) {
      await db.from("ai_tasks").update({ session_cookie: null }).eq("id", task.id);
      const gapText = uncovered.slice(0, 3).join(", ");
      const delivered = await postCallback(task.id, { result: { answer: `ยังไม่สามารถตอบส่วนนี้ได้ครับ — ระบบยังไม่มีข้อมูล/เครื่องมือสำหรับ: ${gapText}`, result: null, ask: null, fail_reason: "CAPABILITY_UNAVAILABLE", missing: uncovered, worker: WORKER_ID, durationMs: Date.now() - t0 } });
      if (!delivered) throw new Error("callback delivery failed after 3 attempts");
      console.log(`[cline-worker] task ${task.id} done-gap (${Date.now() - t0}ms, missing=${gapText})`);
      return;
    }
    const payload = parsed.payload && typeof parsed.payload === "object" ? { ...parsed.payload } : {};
    // DNA OS identity resolution (req: AI ห้ามแตะข้อมูล) — keyword จากภาษาคน
    // ถูกแปลงเป็น partner_id จริงโดย dispatcher เอง
    let resolvedName = null;
    if (payload.keyword && !payload.partner_id) {
      const pf = await dispatchVia(task.session_cookie, "partner.find", { keyword: String(payload.keyword) });
      if (pf.ok && Array.isArray(pf.data) && pf.data.length === 1) {
        payload.partner_id = String(pf.data[0].id);
        resolvedName = String(pf.data[0].name ?? payload.keyword);
        delete payload.keyword;
      }
    }
    if (!payload.partner_id && who && task?.trace?.context?.who_id) payload.partner_id = String(task.trace.context.who_id);
    // DNA-000227: receipt.get โดยไม่ระบุ id → DNA OS resolve จากบริบทสนทนา
    // (AI แปลความหมายแล้ว; ฝั่งระบบเป็นคนเลือกรายการ) — มี who → หลักฐาน
    // ล่าสุดของบริษัทนั้น · ไม่มี who → ขอคำระบุ (ห้ามเดา)
    if (command === "receipt.get" && !payload.receipt_id) {
      if (who && task?.trace?.context?.who_id) {
        const rl = await dispatchVia(task.session_cookie, "receipt.list", { limit: 20 });
        const rows = rl.ok && rl.data && Array.isArray(rl.data.receipts) ? rl.data.receipts.filter((r) => String(r.partner_name ?? "").includes(String(who))) : [];
        if (rows.length > 0) payload.receipt_id = String(rows[0].id);
      }
      if (!payload.receipt_id) {
        await db.from("ai_tasks").update({ session_cookie: null }).eq("id", task.id);
        const delivered = await postCallback(task.id, { result: { answer: "ระบุบริษัทหรือเลขที่หลักฐานรับเงินเพื่อเปิดรายละเอียดครับ", result: null, ask: "ต้องการเปิดหลักฐานของบริษัทใด หรือเลขที่หลักฐานอะไรครับ", worker: WORKER_ID, durationMs: Date.now() - t0 } });
        if (!delivered) throw new Error("callback delivery failed after 3 attempts");
        console.log(`[cline-worker] task ${task.id} done-ask-receipt (${Date.now() - t0}ms)`);
        return;
      }
    }
    // preview: ไม่มี document_id → DNA OS หาใบล่าสุดของคู่ค้าเอง
    if (command === "document.preview" && !payload.document_id && payload.partner_id) {
      const latest = await dispatchVia(task.session_cookie, "invoice.latest", {});
      if (latest.ok && latest.data && latest.data.id) {
        payload.document_id = String(latest.data.id);
        payload.document_kind = "invoice";
      }
    }
    let dispatch = await dispatchVia(task.session_cookie, command, payload);
    // กรองเอกสารตามคู่ค้าที่ resolve ได้ (งาน DNA OS ไม่ใช่งาน AI)
    if (command === "document.list" && dispatch.ok && dispatch.data && resolvedName) {
      const key = Object.keys(dispatch.data).find((k) => Array.isArray(dispatch.data[k]));
      if (key) dispatch.data[key] = dispatch.data[key].filter((r) => String(r.party_name ?? r.name ?? "").includes(resolvedName));
    }
    if (!dispatch.ok) throw new Error(`DATA_QUERY_FAILED: ${String(dispatch.violations?.[0] ?? "unknown").slice(0, 200)}`);
    const result = formatResult(command, dispatch.data);
    const arrCount = result?.type === "table" ? result.table.rows.length : null;
    const isEmpty = result === null || (arrCount === 0);
    if (isEmpty) {
      // ENTITY_NOT_FOUND: คำสั่งถูกต้อง แต่ไม่มีข้อมูลจริง — ห้ามตอบว่าสำเร็จ ห้ามเดา
      await db.from("ai_tasks").update({ session_cookie: null }).eq("id", task.id);
      const delivered = await postCallback(task.id, { result: { answer: "ไม่พบข้อมูลที่ตรงกับคำสั่งนี้ในระบบครับ — ลองระบุชื่อ/เงื่อนไขให้ชัดขึ้น หรือดูรายการทั้งหมดจากหน้าที่เกี่ยวข้อง", result: null, ask: null, fail_reason: "ENTITY_NOT_FOUND", command, worker: WORKER_ID, durationMs: Date.now() - t0 } });
      if (!delivered) throw new Error("callback delivery failed after 3 attempts");
      console.log(`[cline-worker] task ${task.id} done-empty (${Date.now() - t0}ms, cmd=${command})`);
      return;
    }
    const answer = arrCount !== null ? `พบ ${arrCount} รายการครับ` : "ดำเนินการเรียบร้อยครับ";
    await db.from("ai_tasks").update({ session_cookie: null }).eq("id", task.id);
    const delivered = await postCallback(task.id, { result: { answer, result, ask: null, worker: WORKER_ID, durationMs: Date.now() - t0, ai_ms: aiMs, ai_tokens: interp.usage?.totalOutputTokens ?? null, command } });
    if (!delivered) throw new Error("callback delivery failed after 3 attempts");
    console.log(`[cline-worker] task ${task.id} done (${Date.now() - t0}ms, ai=${aiMs}ms, cmd=${command}, result=${result?.type ?? "text"})`);
  } catch (e) {
    await db.from("ai_tasks").update({ session_cookie: null, status: "failed", error: String(e.message).slice(0, 500), processed_at: new Date().toISOString() }).eq("id", task.id);
    console.error(`[cline-worker] task ${task.id} error: ${e.message}`);
    // failure codes คงเดิม: INSUFFICIENT_CREDITS/INTENT_UNKNOWN/CAPABILITY_UNAVAILABLE/DATA_QUERY_FAILED (dispatch failed...) — ห้ามแปลเป็น NOT_FOUND
  }
}

// DNA-000220: กัน tick ซ้อน (setInterval ทุก 8s ระหว่าง executeTask ยังวิ่ง =
// เดิม claim หลายงานพร้อมกันได้) — หนึ่งงานต่อหนึ่งเวลาเท่านั้น
let busy = false;
async function main() {
  if (busy) return;
  busy = true;
  try {
    await mainInner();
  } finally {
    busy = false;
  }
}

async function mainInner() {
  // stale processing cleanup (DNA-000219): container restart ระหว่าง cline ทำ
  // งานจะทิ้ง task ค้างสถานะ processing ตลอดกาล — fail ที่เกิน 8 นาทีเพื่อให้
  // ระบบเห็น error จริง (duplicate ยังถูกกันด้วย atomic claim เดิม)
  await db.from("ai_tasks")
    .update({ status: "failed", error: "stale processing (worker restart or cline timeout)", processed_at: new Date().toISOString() })
    .eq("kind", CLAIM_WHERE).eq("status", "processing")
    .lt("claimed_at", new Date(Date.now() - 8 * 60 * 1000).toISOString());

  const { data: tasks, error } = await db.from("ai_tasks")
    .select("*").eq("kind", CLAIM_WHERE).eq("status", "pending")
    .order("created_at", { ascending: true }).limit(3);
  if (error) { console.error("[cline-worker] query error:", error.message); return; }
  for (const task of tasks ?? []) {
    if (task.expires_at && new Date(task.expires_at).getTime() < Date.now()) {
      await db.from("ai_tasks").update({ status: "failed", error: "expired before claim" }).eq("id", task.id).eq("status", "pending");
      continue;
    }
    await executeTask(task);
  }
}

console.log(`[cline-worker] boot id=${WORKER_ID} bin=${CLINE_BIN} deadboard=${DEADBOARD_URL} poll=${POLL_MS}ms`);

// Railway health endpoint — the platform restarts instances with no listener
// on $PORT; this tiny server also exposes worker health for ops.
import("node:http").then(({ createServer }) => {
  const port = Number(process.env.PORT ?? 8080);
  createServer(async (req, res) => {
    if (req.url === "/health") {
      const { count, error } = await db.from("ai_tasks").select("id", { count: "exact", head: true }).eq("kind", CLAIM_WHERE);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, worker: WORKER_ID, owner_cline_tasks: count ?? 0, query_error: error?.message ?? null }));
      return;
    }
    res.writeHead(404).end();
  }).listen(port, () => console.log(`[cline-worker] health on :${port}`));
});

setInterval(() => main().catch((e) => console.error("[cline-worker] loop error:", e.message)), POLL_MS);
main().catch((e) => console.error("[cline-worker] boot error:", e.message));


