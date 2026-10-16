#!/usr/bin/env node
/**
 * DNA AI Relay Worker (RAILWAY↔MAC LOCAL AI CONNECTION, 2026-10-17).
 *
 * หน้าที่เดียว: เป็นฝ่ายเชื่อมออกจากเครื่อง Mac หา Railway (Railway ไม่พิสูจน์
 * ว่าเข้าถึง Tailnet ได้ — worker จบช่องว่างนั้น) — พอลงาน intent.classify จาก
 * relay ของ DNA OS → ยิง Ollama 127.0.0.1:11434 ที่เครื่องนี้ → ส่งผลกลับ
 *
 * กติกา encode ไว้ตรงนี้:
 *  - ZERO npm deps (Node ≥ 18, fetch มี deadline เสมอ)
 *  - Ollama โดนยิงผ่าน 127.0.0.1 เท่านั้น — ไม่มีการ expose port อะไรออกนอก
 *  - token เก็บใน macOS Keychain (service dnaos.ai-relay, account dnaos)
 *    อ่านครั้งเดียวตอนเริ่ม — ไม่มี token ใน argv / URL / log
 *  - log คู่ acceptance: LOCAL_AI_REQUEST_RECEIVED / OLLAMA_INFERENCE /
 *    RESPONSE_RETURNED พร้อม request_id ที่ Railway ส่งมาพอดี (REQUEST_ID_MATCH)
 *  - deny-by-default: โมเดลต้องมีจริงใน Ollama เครื่องนี้เท่านั้น
 *
 * ตัวแปร:
 *   DNA_AI_RELAY_BASE   ค่าเริ่ม https://dnaos.dev (เพื่อ local loop ชี้ localhost)
 *   DNA_AI_RELAY_TOKEN  (ตัวเลือก) ถ้าไม่ตั้ง อ่านจาก Keychain
 */

import { spawnSync } from "node:child_process";

const BASE = (process.env.DNA_AI_RELAY_BASE ?? "https://dnaos.dev").replace(/\/+$/, "");
const OLLAMA_URL = (process.env.DNA_OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
const POLL_MS = Math.min(Number(process.env.DNA_AI_RELAY_POLL_MS) || 20_000, 25_000);
const INFERENCE_TIMEOUT_MS = Number(process.env.DNA_AI_RELAY_INFERENCE_TIMEOUT_MS) || 110_000;

const SERVICE_TOKEN = "dnaos.ai-relay";

function keychainToken() {
  const r = spawnSync("security", ["find-generic-password", "-s", SERVICE_TOKEN, "-a", "dnaos", "-w"], { encoding: "utf-8" });
  return r.status === 0 ? (r.stdout || "").trim() : null;
}

function token() {
  const fromEnv = (process.env.DNA_AI_RELAY_TOKEN ?? "").trim();
  if (fromEnv) return fromEnv;
  const fromKeychain = keychainToken();
  if (!fromKeychain) {
    console.error(`[ai-relay] token ไม่พบ (env DNA_AI_RELAY_TOKEN หรือ Keychain ${SERVICE_TOKEN})`);
    process.exit(3);
  }
  return fromKeychain;
}

const HEADERS = { "Content-Type": "application/json", "x-dna-ai-relay-token": token() };
console.log(`[ai-relay] start → ${BASE} · ollama → ${OLLAMA_URL} (token=${process.env.DNA_AI_RELAY_TOKEN ? "env" : "keychain"})`);

/** โมเดลที่มีจริงบนเครื่องนี้ — deny-by-default (แคชสั้น ๆ) */
let localModels = new Set();
async function refreshModels() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
    const body = await res.json();
    localModels = new Set((body?.models ?? []).map((m) => String(m.name ?? m.model ?? "")));
  } catch (e) {
    console.error(`[ai-relay] ollama /api/tags ล้มเหลว: ${String(e.message ?? e)}`);
  }
}

async function postJson(url, payload, timeoutMs) {
  const res = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(payload ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function runOllama(job) {
  const started = Date.now();
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: job.model,
      system: job.system ?? undefined,
      prompt: job.prompt,
      images: Array.isArray(job.images) ? job.images : undefined,
      stream: false,
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  const body = await res.json();
  const text = typeof body?.response === "string" ? body.response.trim() : "";
  if (!text) throw new Error("ollama empty response");
  console.log(`[ai-relay] OLLAMA_INFERENCE id=${job.request_id} model=${job.model} ms=${Date.now() - started}`);
  return text;
}

async function handleJob(job) {
  console.log(`[ai-relay] LOCAL_AI_REQUEST_RECEIVED id=${job.request_id} model=${job.model} prompt_len=${String(job.prompt ?? "").length}`);
  try {
    if (!localModels.has(job.model)) {
      await refreshModels();
      if (!localModels.has(job.model)) throw new Error(`model ไม่มีในเครื่องนี้: ${job.model}`);
    }
    const response = await runOllama(job);
    await postJson(`${BASE}/api/internal/ai/ollama-relay/api/result`, { request_id: job.request_id, ok: true, response_text: response }, 15_000);
    console.log(`[ai-relay] RESPONSE_RETURNED id=${job.request_id} bytes=${response.length}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[ai-relay] job ${job.request_id} ล้มเหลว: ${message}`);
    try {
      await postJson(`${BASE}/api/internal/ai/ollama-relay/api/result`, { request_id: job.request_id, ok: false, error: message }, 15_000);
    } catch { /* ผลล้มเหลวส่งไม่ถึง — waiter จะ timeout จากฝั่ง Railway เอง */ }
  }
}

// ตรวจโมเดล/ช่องทางก่อนเข้า loop — ล้มเหลวแรงก็ให้ซ่อมก่อนเปิดบริการ
await refreshModels();
if (localModels.size === 0) {
  console.error("[ai-relay] หยุด: Ollama ไม่มีโมเดลในเครื่อง / ไม่ตอบ");
  process.exit(4);
}

for (;;) {
  try {
    const { status, json } = await postJson(`${BASE}/api/internal/ai/ollama-relay/api/poll`, { wait_ms: POLL_MS }, POLL_MS + 20_000);
    if (status !== 200) {
      console.error(`[ai-relay] poll HTTP ${status} — รอ 5s`);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    const job = json?.job;
    if (job && typeof job.request_id === "string") {
      await handleJob(job);
      continue; // มีงานอยู่แล้ว — พอลถัดไปทันที
    }
  } catch (e) {
    console.error(`[ai-relay] poll error: ${e instanceof Error ? e.message : e} — รอ 5s`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
