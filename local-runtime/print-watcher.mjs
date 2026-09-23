// Bridges the cloud (print_jobs rows written by the LINE webhook, once a
// customer's document + payment are both verified) to the real physical
// printer (Brother DCP-T430W, WiFi/AirPrint via CUPS on this Mac). The
// webhook runs in Deno on Supabase's servers and has no way to reach a
// printer on a home WiFi network — this script is the only thing that can.
// Designed to run forever via a macOS LaunchAgent (see
// com.dnaos.print-watcher.plist), independent of any Claude/chat session.
import { createClient } from "@supabase/supabase-js";
import { runDeviceAiCapability } from "./ai/device-ai-runtime.mjs";
import { createDeviceEvidence } from "./ai/device-ai-evidence.mjs";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { getReadyOllamaUrl } from "./ollama-cloud-gateway.mjs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRINTER = "Brother_DCP_T430W";

const env = Object.fromEntries(
  readFileSync(`${PROJECT_DIR}/.env.local`, "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Mirrors registry/communication.ts's sendLineMessage() — that file is TS
// with a `@/` path alias, not importable directly from a standalone Node
// script, so the same LINE Messaging API push call is replicated here
// rather than duplicating a separate outbound-messaging system (Rule 111).
async function sendLineText(lineUserId, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) throw new Error(`LINE push http ${res.status}: ${await res.text()}`);
}

// Auto-crop (owner-reported bug, 2026-07-26): "ให้ระบบตัดเอาเฉพาะรูปภาพบัตร
// ประชาชนเท่านั้น...สแกนตัดเอาเฉพาะขอบบัตรประชาชนสี่เหลี่ยม" — the raw photo
// includes whatever background/table the customer photographed it on;
// detect the card's edges and crop to just the card before laying it out.
// Uses the same adapter-configured Cloud Runtime vision model (via
// ollama-cloud-gateway.mjs) already proven for OCR classification, asked
// instead for a bounding box — an approximate,
// best-effort estimate (vision-model spatial grounding is not pixel-exact),
// not a calibrated computer-vision edge detector. ImageMagick (`convert`/
// `identify`, installed via `brew install imagemagick` for this) does the
// actual crop/rotate/compose once we have the box.
const BBOX_PROMPT = `ในรูปนี้มีบัตรประชาชนหรือเอกสารราชการวางอยู่ พร้อมพื้นหลัง/โต๊ะ/มืออาจติดมาด้วย
ให้ระบุกรอบสี่เหลี่ยมของ "ตัวบัตร/เอกสารเท่านั้น" ไม่รวมพื้นหลัง ตอบเป็น JSON เท่านั้น:
{"x": ตำแหน่งซ้ายสุดของบัตร (0-1 ของความกว้างรูป), "y": ตำแหน่งบนสุดของบัตร (0-1 ของความสูงรูป), "width": ความกว้างบัตร (0-1), "height": ความสูงบัตร (0-1)}
ถ้าบัตรเอียง ให้กรอบครอบคลุมบัตรทั้งหมดแบบตรง (axis-aligned) ไม่ต้องหมุน`;

function imageDimensions(path) {
  const out = execSync(`identify -format "%w %h" "${path}"`).toString().trim().split(" ");
  return { width: parseInt(out[0], 10), height: parseInt(out[1], 10) };
}

async function detectCardBoundingBox(imagePath) {
  const b64 = readFileSync(imagePath).toString("base64");
  const endpoint = await getReadyOllamaUrl("[print-watcher]");
  if (!endpoint) return null; // Cloud Runtime not ready — skip auto-crop this round rather than fail the whole print job
  const result = await runDeviceAiCapability(
    "document.crop",
    { systemPrompt: BBOX_PROMPT, prompt: "ระบุกรอบบัตร", images: [b64], maxTokens: 300 },
    { endpoint, evidence: createDeviceEvidence({ db, origin: "local-runtime/print-watcher.mjs" }) },
  );
  if (!result.ok) return null;
  const match = result.output.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const box = JSON.parse(match[0]);
    if ([box.x, box.y, box.width, box.height].some((v) => typeof v !== "number" || v < 0 || v > 1)) return null;
    return box;
  } catch {
    return null;
  }
}

// Real-size layout (owner-reported bug, 2026-07-26): "-o fit-to-page"
// stretched the photo to fill the whole A4 sheet — nobody wants a photocopy
// of their ID card blown up to poster size. Thai ID cards are a real,
// fixed physical size (ISO/IEC 7810 ID-1: 85.60 × 53.98 mm, same as a
// credit card) — resize the photo to that real size at 300 DPI, pad it
// centered onto a real A4 canvas (2480×3508 px @ 300 DPI), and print with
// an explicit ppi so CUPS doesn't rescale it again. Honest limitation: this
// assumes ID-card dimensions for every "government_document" job — a
// ทะเบียนบ้าน (house registration) page is a different real size
// (closer to A5/A4), and would print too small under this same box today;
// not yet distinguished since document_kind doesn't carry that detail.
const DPI = 300;
const MM_TO_IN = (mm) => mm / 25.4;
const A4_W_PX = Math.round(MM_TO_IN(210) * DPI);
const A4_H_PX = Math.round(MM_TO_IN(297) * DPI);
const ID_CARD_W_PX = Math.round(MM_TO_IN(85.6) * DPI);
const ID_CARD_H_PX = Math.round(MM_TO_IN(53.98) * DPI);

async function printJob(job) {
  const { data, error } = await db.storage.from("attachments").download(job.media_path);
  if (error || !data) throw new Error(`ดาวน์โหลดไฟล์ไม่ได้: ${error?.message ?? "no data"}`);

  const buf = Buffer.from(await data.arrayBuffer());
  const ext = job.media_path.split(".").pop() || "jpg";
  const tmpPath = `/tmp/print-job-${job.id}.${ext}`;
  const laidOutPath = `/tmp/print-job-${job.id}-a4.jpg`;
  writeFileSync(tmpPath, buf);

  const croppedPath = `/tmp/print-job-${job.id}-crop.jpg`;
  const resizedPath = `/tmp/print-job-${job.id}-resized.jpg`;

  try {
    let sourceForResize = tmpPath;

    if (job.document_kind === "government_document") {
      const box = await detectCardBoundingBox(tmpPath);
      if (box) {
        const { width: imgW, height: imgH } = imageDimensions(tmpPath);
        const cropX = Math.round(box.x * imgW);
        const cropY = Math.round(box.y * imgH);
        const cropW = Math.round(box.width * imgW);
        const cropH = Math.round(box.height * imgH);
        execSync(`convert "${tmpPath}" -crop ${cropW}x${cropH}+${cropX}+${cropY} +repage "${croppedPath}"`, { stdio: "pipe" });

        // Owner instruction (2026-07-26): "บัตรประชาชนน่ะเป็นแนวนอน" — force
        // landscape, since a mis-cropped or rotated photo can come out taller
        // than wide.
        const { width: cw, height: ch } = imageDimensions(croppedPath);
        if (ch > cw) {
          execSync(`convert "${croppedPath}" -rotate 90 "${croppedPath}"`, { stdio: "pipe" });
        }
        sourceForResize = croppedPath;
      }
      // No usable box — fall back to the whole photo rather than fail the job.
    }

    // Resize to real card size (max box), preserving aspect ratio.
    execSync(`convert "${sourceForResize}" -resize ${ID_CARD_W_PX}x${ID_CARD_H_PX} "${resizedPath}"`, { stdio: "pipe" });
    const { width: rw, height: rh } = imageDimensions(resizedPath);

    // Owner instruction (2026-07-26): "กึ่งกลางลดลงมาจากหน้ากระดาษ A4
    // ประมาณสองสามส่วน" — horizontally centered, but positioned lower than
    // true vertical center (~62% down the page) rather than dead-center.
    const offsetX = Math.round((A4_W_PX - rw) / 2);
    const offsetY = Math.round(A4_H_PX * 0.62 - rh / 2);

    execSync(`convert -size ${A4_W_PX}x${A4_H_PX} xc:white "${laidOutPath}"`, { stdio: "pipe" });
    execSync(`composite -geometry +${offsetX}+${offsetY} "${resizedPath}" "${laidOutPath}" "${laidOutPath}"`, { stdio: "pipe" });

    // Print with an explicit ppi so CUPS doesn't rescale our already-A4-sized
    // canvas again — no fit-to-page, no further scaling.
    execSync(`lp -d ${PRINTER} -n ${job.copies} -o ppi=${DPI} "${laidOutPath}"`);
    console.log(`[print-watcher] ✓ พิมพ์แล้ว job ${job.id} (${job.copies} แผ่น, ${job.document_kind ?? "?"}, ขนาดจริง+ตัดขอบ)`);
  } finally {
    for (const p of [tmpPath, croppedPath, resizedPath, laidOutPath]) {
      try { unlinkSync(p); } catch { /* may not exist */ }
    }
  }
}

async function main() {
  const { data: jobs, error } = await db
    .from("print_jobs")
    .select("*")
    .eq("status", "paid")
    .order("paid_at", { ascending: true });

  if (error) {
    console.error(`[print-watcher] ${new Date().toISOString()} query error: ${error.message}`);
    return;
  }
  if (!jobs || jobs.length === 0) return;

  console.log(`[print-watcher] ${new Date().toISOString()} พบงานพิมพ์ที่จ่ายเงินแล้ว ${jobs.length} งาน`);

  for (const job of jobs) {
    try {
      await printJob(job);
      await db.from("print_jobs")
        .update({ status: "printed", printed_at: new Date().toISOString() })
        .eq("id", job.id);
      try {
        await sendLineText(job.line_user_id, "เอกสารพิมพ์เสร็จแล้วครับ มารับได้เลย 🙏");
        await db.from("print_jobs")
          .update({ status: "notified", notified_at: new Date().toISOString() })
          .eq("id", job.id);
      } catch (notifyErr) {
        // Print already succeeded — a failed notification must not roll that
        // back or re-queue a real reprint. Leave status "printed"; the owner
        // can see it printed and tell the customer directly if LINE push failed.
        console.error(`[print-watcher] ⚠ พิมพ์แล้วแต่แจ้ง LINE ไม่สำเร็จ job ${job.id}: ${notifyErr.message}`);
      }
    } catch (e) {
      console.error(`[print-watcher] ✗ ล้มเหลว job ${job.id}: ${e.message}`);
      await db.from("print_jobs")
        .update({ status: "failed", print_error: e.message })
        .eq("id", job.id);
    }
  }
}

main().catch((e) => console.error("[print-watcher] FATAL:", e));
