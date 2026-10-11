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
function systemPrompt(proxyPort, who) {
  return `คุณคือผู้ช่วย AI ของ DNA OS — เรียกข้อมูลจากระบบแล้วเรียบเรียงผลให้เจ้าของ${who ? ` (คู่ค้าที่กำลังคุยอยู่: ${who})` : ""}
กติกาเหล็ก:
1. เครื่องมือเดียว: POST http://127.0.0.1:${proxyPort}/api/v1/mcp/business/dispatch
   body: {"command":"<read command>","payload":{...}} — ไม่ต้อง fetch manifest (รู้คำสั่งอยู่แล้ว)
   คำสั่งอ่าน: partner.find, partner.list, partner.profile, partner.timeline, document.list, invoice.list, invoice.latest, invoice.find, debt.list, debt.all, draft.list, job.list, job.active, document.preview ({document_id, document_kind})
2. ใช้ไม่เกิน 3 ครั้ง · ห้ามเดาข้อมูลใด ๆ ที่ไม่ได้มาจากผล dispatch · สถานะเอกสารแสดงตามจริง (void/ยกเลิก ห้ามปิดบัง)
3. คำตอบสุดท้าย JSON เท่านั้น รูปทรง ChatResult ตรงเป๊ะ (รูปทรงเพี้ยน = ระบบจะทิ้ง result):
   - รายการเอกสาร/ใบแจ้งหนี้ → TABLE: {"answer":"สรุปสั้น 1-2 ประโยค","result":{"type":"table","title":"เอกสารล่าสุดของ <ชื่อบริษัท>","table":{"columns":[{"key":"c1","label":"เลขที่เอกสาร"},{"key":"c2","label":"ประเภท"},{"key":"c3","label":"วันที่"},{"key":"c4","label":"ยอดรวม"},{"key":"c5","label":"สถานะ"},{"key":"c6","label":"อ้างอิง"}],"rows":[["INV-...","ใบแจ้งหนี้","2026-09-22","3,371.04","void","-"]]}},"ask":null}
   - ข้อมูลบริษัท → SECTIONS: {"answer":"...","result":{"type":"sections","blocks":[{"kind":"fields","id":"company","title":"<ชื่อบริษัท>","fields":[{"kind":"field","id":"f1","label":"โทรศัพท์","value":"..."}]}]}}
   - เปิดเอกสารต้นฉบับ: เรียก document.preview ก่อน — ถ้าคืน mode=file → {"type":"file","name":"<เลขที่เอกสาร>","path":"<storage_path>","mime":"<mime>","size":<size>} · ถ้า mode=summary → {"type":"document","title":"ตัวอย่างเอกสาร <เลขที่> (canonical preview ไม่ใช่ไฟล์ต้นฉบับ)","html":"<summary_html>"}
   - ถามกำกวม → {"answer":"...","result":null,"ask":"คำถาม"}`;
}

function runCline(message, proxyPort, who) {
  return new Promise((resolve) => {
    // quirk: Thai/single-token prompt must be FIRST arg + trailing space
    const args = [`${message.trim().slice(0, 2000)} `, "--json", "--auto-approve", "true",
      "-t", String(CLINE_TIMEOUT_SECONDS), "-s", systemPrompt(proxyPort, who)];
    let out = "";
    // detached = own process group → timeout ฆ่าทั้งกลุ่ม (ลูกๆ ของ cline ด้วย)
    const child = spawn(CLINE_BIN, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env }, detached: true });
    const killer = setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
    }, (CLINE_TIMEOUT_SECONDS + 20) * 1000);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.on("error", (e) => { clearTimeout(killer); resolve({ error: `spawn: ${e.message}` }); });
    child.on("close", () => {
      clearTimeout(killer);
      let text = null;
      for (const line of out.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try { const m = JSON.parse(line); if (m.type === "run_result" && typeof m.text === "string") text = m.text; } catch { /* partial */ }
      }
      if (!text) return resolve({ error: "no run_result (timeout or crash)" });
      const cleaned = text.replace(/```(?:json)?\s*/gi, "").trim();
      const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
      try { resolve(JSON.parse(cleaned.slice(start, end + 1))); }
      catch { resolve({ answer: text.slice(0, 2000), result: null }); }
    });
  });
}

async function postCallback(taskId, payload) {
  // DNA-000220: callback ต้อง retry และ failure ต้องชัดเจน — เดิม log "done"
  // ทั้งที่ callback 401 → task ค้าง processing → cleanup มา fail ทีหลัง
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

async function executeTask(task) {
  const t0 = Date.now();
  const started = await db.from("ai_tasks")
    .update({ status: "processing", claimed_by: WORKER_ID, claimed_at: new Date().toISOString() })
    .eq("id", task.id).eq("status", "pending").select("id");
  if (!started.data?.length) return; // someone else claimed — duplicate protection
  try {
    const prox = await startTaskProxy(task.session_cookie);
    if (!prox) throw new Error("proxy start failed");
    let out;
    try {
      out = await runCline(task.input_text || "", prox.port, task?.trace?.context?.who || null);
    } finally {
      try { prox.proxy.close(); } catch { /* already closed */ }
    }
    // clear the session cookie BEFORE callback (secret minimisation)
    await db.from("ai_tasks").update({ session_cookie: null }).eq("id", task.id);
    if (out.error) {
      await db.from("ai_tasks").update({ status: "failed", error: String(out.error).slice(0, 500), processed_at: new Date().toISOString() }).eq("id", task.id);
      console.log(`[cline-worker] task ${task.id} failed: ${out.error} (${Date.now() - t0}ms)`);
      return;
    }
    const delivered = await postCallback(task.id, { result: { answer: out.answer ?? "", result: out.result ?? null, ask: out.ask ?? null, worker: WORKER_ID, durationMs: Date.now() - t0 } });
    if (!delivered) {
      await db.from("ai_tasks").update({ status: "failed", error: "callback delivery failed after 3 attempts", processed_at: new Date().toISOString() }).eq("id", task.id);
      console.error(`[cline-worker] task ${task.id} callback failed after retries (${Date.now() - t0}ms)`);
      return;
    }
    console.log(`[cline-worker] task ${task.id} done (${Date.now() - t0}ms, result=${out.result?.type ?? "text"})`);
  } catch (e) {
    await db.from("ai_tasks").update({ session_cookie: null, status: "failed", error: String(e.message).slice(0, 500), processed_at: new Date().toISOString() }).eq("id", task.id);
    console.error(`[cline-worker] task ${task.id} error: ${e.message}`);
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


