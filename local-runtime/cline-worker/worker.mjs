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
import { spawn } from "node:child_process";
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
  return `คุณคือผู้ช่วย AI ของ DNA OS — เข้าใจคำสั่งภาษาคน ค้นข้อมูลจากระบบ และเรียบเรียงผลให้เจ้าของ${who ? ` (คู่ค้าที่กำลังคุยอยู่: ${who})` : ""}
กติกาเหล็ก:
1. เครื่องมือเดียว: HTTP ของ DNA OS ผ่าน base URL http://127.0.0.1:${proxyPort}
   - GET /api/v1/mcp/manifest (ครั้งแรก)
   - POST /api/v1/mcp/business/dispatch {"command":"<read command>","payload":{...}}
   คำสั่งอ่านที่อนุญาต: partner.find, partner.list, partner.profile, partner.timeline, document.list, invoice.list, invoice.latest, invoice.find, debt.list, debt.all, draft.list, job.list, job.active, document.preview ({document_id, document_kind})
2. ห้ามอ่าน/เขียนไฟล์ ห้ามเรียก endpoint อื่น ใช้ไม่เกิน 4 ครั้ง · ห้ามเดาข้อมูลใด ๆ ที่ไม่ได้มาจากผล dispatch
3. คำสั่งกำกวม → {"ask":"คำถาม"} · คำตอบสุดท้าย JSON เท่านั้น {"answer":"...","result":<sections|table|timeline|file|document ตาม result contract ของ Workspace>,"ask":null}`;
}

function runCline(message, proxyPort, who) {
  return new Promise((resolve) => {
    // quirk: Thai/single-token prompt must be FIRST arg + trailing space
    const args = [`${message.trim().slice(0, 2000)} `, "--json", "--auto-approve", "true",
      "-t", String(CLINE_TIMEOUT_SECONDS), "-s", systemPrompt(proxyPort, who)];
    let out = "";
    const child = spawn(CLINE_BIN, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
    const killer = setTimeout(() => child.kill("SIGKILL"), (CLINE_TIMEOUT_SECONDS + 20) * 1000);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.on("error", (e) => { clearTimeout(killer); resolve({ error: `spawn: ${e.message}` }); });
    child.on("close", () => {
      clearTimeout(killer);
      let text = null;
      for (const line of out.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try { const m = JSON.parse(line); if (m.type === "run_result" && typeof m.text === "string") text = m.text; } catch { /* partial */ }
      }
      if (!text) return resolve({ error: "no run_result" });
      const cleaned = text.replace(/```(?:json)?\s*/gi, "").trim();
      const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
      try { resolve(JSON.parse(cleaned.slice(start, end + 1))); }
      catch { resolve({ answer: text.slice(0, 2000), result: null }); }
    });
  });
}

async function postCallback(taskId, payload) {
  const res = await fetch(CALLBACK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-callback-secret": CALLBACK_SECRET },
    body: JSON.stringify({ taskId, kind: CLAIM_WHERE, ...payload }),
  });
  return res.ok;
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
    const out = await runCline(task.input_text || "", prox.port, task.claim_who || null);
    prox.proxy.close();
    // clear the session cookie BEFORE callback (secret minimisation)
    await db.from("ai_tasks").update({ session_cookie: null }).eq("id", task.id);
    if (out.error) {
      await db.from("ai_tasks").update({ status: "failed", error: String(out.error).slice(0, 500), processed_at: new Date().toISOString() }).eq("id", task.id);
      console.log(`[cline-worker] task ${task.id} failed: ${out.error} (${Date.now() - t0}ms)`);
      return;
    }
    await postCallback(task.id, { result: { answer: out.answer ?? "", result: out.result ?? null, ask: out.ask ?? null, worker: WORKER_ID, durationMs: Date.now() - t0 } });
    console.log(`[cline-worker] task ${task.id} done (${Date.now() - t0}ms, result=${out.result?.type ?? "text"})`);
  } catch (e) {
    await db.from("ai_tasks").update({ session_cookie: null, status: "failed", error: String(e.message).slice(0, 500), processed_at: new Date().toISOString() }).eq("id", task.id);
    console.error(`[cline-worker] task ${task.id} error: ${e.message}`);
  }
}

async function main() {
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


