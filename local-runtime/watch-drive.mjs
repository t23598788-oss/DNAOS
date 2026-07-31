// Persistent Google Drive watcher — reads NEW financial document images from
// the locally-synced Google Drive folder using thawatchai (local Ollama
// vision, qwen2.5vl:7b), inserts real rows into receipt_documents. Designed
// to run independently forever via a macOS LaunchAgent (see
// com.dnaos.drive-watcher.plist) — does NOT depend on any Claude/AI chat
// session being open. Tracks already-processed files in a local log so it
// never double-processes on repeated runs.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync, existsSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";

const PROJECT_DIR = "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /dna-os-deadboard";
const DRIVE_ROOT = "/Users/tam/Library/CloudStorage/GoogleDrive-t23598788@gmail.com/ไดรฟ์ของฉัน";
const PROCESSED_LOG = "/Users/tam/dna-os-ollama/drive-processed.log";

const env = Object.fromEntries(
  readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function loadProcessed() {
  if (!existsSync(PROCESSED_LOG)) return new Set();
  return new Set(readFileSync(PROCESSED_LOG, "utf8").split("\n").filter(Boolean));
}

function listImagesRecursive(dir, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return [];
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out = out.concat(listImagesRecursive(full, depth + 1, maxDepth));
    } else if (/\.(jpg|jpeg|png)$/i.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

async function extractSlip(imagePath) {
  const buf = readFileSync(imagePath);
  const b64 = buf.toString("base64");
  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen2.5vl:7b",
      prompt: "อ่านรูปนี้ ตอบเป็น JSON เท่านั้น format: {\"sender\":\"ชื่อผู้โอน หรือ null\",\"receiver\":\"ชื่อผู้รับ หรือ null\",\"amount\":ตัวเลขเงินอย่างเดียว หรือ null,\"bank\":\"ธนาคาร หรือ null\",\"is_receipt_type\":true หรือ false (true เฉพาะสลิปโอนเงิน/ใบเสร็จ/ใบแจ้งหนี้จริง)}",
      images: [b64],
      stream: false,
      format: "json",
    }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const json = await res.json();
  return JSON.parse(json.response);
}

async function main() {
  if (!existsSync(DRIVE_ROOT)) {
    console.log(`[drive-watcher] ${new Date().toISOString()} ไม่พบโฟลเดอร์ Google Drive ที่ ${DRIVE_ROOT} — ข้ามรอบนี้`);
    return;
  }
  const processed = loadProcessed();
  const allFiles = listImagesRecursive(DRIVE_ROOT);
  const newFiles = allFiles.filter((f) => !processed.has(f));

  if (newFiles.length === 0) {
    console.log(`[drive-watcher] ${new Date().toISOString()} ไม่มีไฟล์ใหม่ (สแกน ${allFiles.length} ไฟล์ทั้งหมด)`);
    return;
  }

  console.log(`[drive-watcher] ${new Date().toISOString()} พบไฟล์ใหม่ ${newFiles.length} ไฟล์ — ประมวลผล...`);

  for (const f of newFiles) {
    try {
      const parsed = await extractSlip(f);
      if (parsed.is_receipt_type && parsed.amount) {
        const mtime = statSync(f).mtime.toISOString().slice(0, 10);
        await db.from("receipt_documents").insert({
          media_path: `local_drive:${f}`,
          document_type: "transfer_slip",
          vendor_name: parsed.receiver ?? null,
          sender_name: parsed.sender ?? null,
          amount: Number(parsed.amount) || null,
          document_date: mtime,
          confidence: 0.7,
          status: "ai_read",
          payment_verified: false,
          raw_ocr_text: JSON.stringify(parsed),
        });
        console.log(`[drive-watcher]   ✓ บันทึกแล้ว: ${parsed.sender ?? "?"} -> ${parsed.receiver ?? "?"} : ${parsed.amount} บาท`);
      } else {
        console.log(`[drive-watcher]   - ข้าม (ไม่ใช่เอกสารการเงิน): ${f.split("/").pop()}`);
      }
      appendFileSync(PROCESSED_LOG, f + "\n");
    } catch (e) {
      console.log(`[drive-watcher]   ✗ ล้มเหลว ${f}: ${e.message}`);
      // ไม่บันทึกลง processed log ถ้าล้มเหลว — จะลองใหม่รอบหน้า
    }
  }
}

main().catch((e) => console.error("[drive-watcher] FATAL:", e));
