// Backfill real slip images (owner's local folders, March-July 2026) into
// receipt_documents via Cloud Runtime vision (the adapter-configured model, via
// ollama-cloud-gateway.mjs, Migration Completion 2026-08-04 — no local
// Ollama, no ANTHROPIC_API_KEY needed either).
// Real extraction, real creation THROUGH the Connect inbound bridge (owner
// channel-expansion 2026-10-07 — NO direct insert; canonical writer + audit,
// channel "upload" with media_path local_backfill:<path> keeping the true
// origin) — logs every file processed/skipped/failed, never fabricates a row
// for an image that didn't parse cleanly, never falls back to a direct write.
import { createClient } from "@supabase/supabase-js";
import { runDeviceAiCapability } from "./ai/device-ai-runtime.mjs";
import { createDeviceEvidence } from "./ai/device-ai-evidence.mjs";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { getReadyOllamaUrl } from "./ollama-cloud-gateway.mjs";
import { sendConnectInboundSource } from "./connect-inbound.mjs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FOLDERS = [
  "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /รูปภาพและข้อมูลสลิปการเงิน/K PLUS",
  "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /รูปภาพและข้อมูลสลิปการเงิน/สลิป K PLUS",
  "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /รูปภาพและข้อมูลสลิปการเงิน/K BIZ",
  "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /รูปภาพและข้อมูลสลิปการเงิน/TrueMoney",
];

function listImages(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function thaiToIsoDate(thaiDateTime, fileModTime) {
  // best-effort: fall back to file mtime if the model's date string can't
  // be parsed reliably — never fabricate a date, real fallback is real data
  return fileModTime;
}

async function extractSlip(imagePath) {
  const buf = readFileSync(imagePath);
  const b64 = buf.toString("base64");
  const endpoint = await getReadyOllamaUrl("[backfill-slips-test]");
  if (!endpoint) throw new Error("Cloud Runtime ยังไม่พร้อม");
  const result = await runDeviceAiCapability(
    "document.ocr",
    { prompt: "อ่านสลิปโอนเงินนี้ ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น format: {\"sender\":\"ชื่อผู้โอน หรือ null\",\"receiver\":\"ชื่อผู้รับ หรือ null\",\"amount\":ตัวเลขจำนวนเงินอย่างเดียว ไม่มีหน่วย หรือ null,\"bank\":\"ธนาคาร หรือ null\",\"is_receipt_type\":true หรือ false (true ถ้าเป็นสลิปโอนเงิน/ใบเสร็จจริง false ถ้าไม่ใช่)}", images: [b64], maxTokens: 500 },
    { endpoint, evidence: createDeviceEvidence({ db, origin: "local-runtime/backfill-slips-test.mjs" }) },
  );
  if (!result.ok) throw new Error(result.error);
  return JSON.parse(result.output);
}

async function main() {
  const files = FOLDERS.flatMap(listImages).slice(0, 3);
  console.log(`พบรูปทั้งหมด ${files.length} รูป — เริ่มประมวลผล...`);

  let ok = 0, skipped = 0, failed = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const label = `[${i + 1}/${files.length}]`;
    try {
      const parsed = await extractSlip(f);
      if (!parsed.is_receipt_type || !parsed.amount) {
        console.log(`${label} ข้าม (ไม่ใช่สลิป/ไม่มียอดเงิน): ${f}`);
        skipped++;
        continue;
      }
      const mtime = statSync(f).mtime.toISOString().slice(0, 10);
      // Connect inbound bridge (channel "upload", media_path keeps the true
      // local_backfill origin) — failure = counted failed, NO direct fallback.
      const created = await sendConnectInboundSource(env, {
        channel: "upload",
        media_path: `local_backfill:${f}`,
        document_type: "transfer_slip",
        vendor_name: parsed.receiver ?? null,
        sender_name: parsed.sender ?? null,
        amount: Number(parsed.amount) || null,
        document_date: mtime,
        confidence: 0.7,
        status: "ai_read",
        raw_ocr_text: JSON.stringify(parsed),
        provenance: { origin: "local-runtime/backfill-slips-test.mjs", file: f },
      }, "local-runtime:backfill-slips-test");
      if (!created.ok) throw new Error(created.error ?? "INBOUND_BRIDGE_FAILED");
      console.log(`${label} ✓ ${parsed.sender ?? "?"} -> ${parsed.receiver ?? "?"} : ${parsed.amount} บาท (${f.split("/").pop()})`);
      ok++;
    } catch (e) {
      console.log(`${label} ✗ ล้มเหลว: ${f} — ${e.message}`);
      failed++;
    }
  }

  console.log(`\n=== เสร็จสิ้น ===`);
  console.log(`บันทึกสำเร็จ: ${ok}`);
  console.log(`ข้าม (ไม่ใช่สลิป): ${skipped}`);
  console.log(`ล้มเหลว: ${failed}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
