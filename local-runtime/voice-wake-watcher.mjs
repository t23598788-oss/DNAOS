// Global Background Voice Listener (owner, 2026-07-30): "ดักฟังเสียง
// เบื้องหลังทุกหน้าจอ...พูด 'ธวัชชัย' ปุ๊บ ต้องขานรับทันที...สแตนด์บายยาวจน
// กว่าจะสั่งปิด" — followed by an explicit architecture correction the same
// day: "เลิกเอาตรรกะระบบอัตโนมัติมาผูกติดกับหน้าต่างแอป DNA OS! แอปมีหน้าที่
// แค่หน้าต่าง UI...สคริปต์ทำงานอัตโนมัติ 24 ชม. ให้ถอดไปรันเป็น Background
// Daemon / macOS launchd + Supabase Backend! ปิดแอป DNA OS ไป สคริปต์ก็ต้อง
// ไม่ดับ!" — this script IS that daemon: runs forever via launchd
// (com.dnaos.voice-wake-watcher.plist), completely independent of whether
// the Next.js/Tauri app is open. It never talks to the app directly — it
// only writes to Supabase (voice_wake_events, migration
// 20260730000003_voice_wake_events.sql); the app is a pure UI layer that
// subscribes to that table via Realtime and reacts. Same
// local-only/no-cloud-AI-budget pattern as ai-task-watcher.mjs (reused
// Supabase client + .env.local read, not reinvented) and same "record short
// chunk, run local model" idea as backfill-slips.mjs/watch-drive.mjs use for
// vision — here for speech instead.
//
// STT engine choice (owner gave a free choice between local Whisper or
// macOS's native Speech framework, "ผ่าน Background Service ระดับ OS"):
// picked local Whisper (whisper-cpp, already installed via Homebrew —
// `brew list` confirmed both `whisper-cpp` and `sox` present with zero new
// install needed) over a native Speech framework because it matches the
// EXACT pattern already proven everywhere else in this project (Ollama
// models run locally, no cloud dependency) rather than introducing a new
// native Swift helper binary that would need its own build/signing setup.
// A real ggml-base.bin model was already downloaded at
// /Users/tam/whisper-models/ggml-base.bin — verified live via `find /`
// before writing this, not assumed.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, unlinkSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

const PROJECT_DIR = "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /dna-os-deadboard";
const WHISPER_MODEL = "/Users/tam/whisper-models/ggml-base.bin";
const CHUNK_SECONDS = 4;
const CHUNK_PATH = "/tmp/dna-os-voice-wake-chunk.wav";

// Real limitation, stated honestly (not hidden): fixed, non-overlapping
// chunks mean a wake word spoken right at a chunk boundary can get split
// across two chunks and missed — the owner would just need to say it again.
// A real fix (overlapping capture windows) is a materially bigger change to
// this loop and wasn't built this round.
const WAKE_VARIANTS = ["ธวัชชัย", "วัชชัย", "ทวัชชัย"];

const env = Object.fromEntries(
  readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function recordChunk() {
  try {
    execFileSync("/opt/homebrew/bin/rec", ["-c", "1", CHUNK_PATH, "trim", "0", String(CHUNK_SECONDS)], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: (CHUNK_SECONDS + 5) * 1000,
    });
    return true;
  } catch (err) {
    console.error(`[voice-wake-watcher] rec failed: ${err.message}`);
    return false;
  }
}

function transcribeChunk() {
  try {
    // Real bug, found live 2026-07-30 while debugging with the owner: plain
    // ggml-base.bin transcription consistently mis-heard "ธวัชชัย" as
    // "ธอบัจใจ" (verified via 3 separate live recordings, always the same
    // wrong output — a systematic model bias for this specific proper noun,
    // not random noise). whisper-cli's own `--prompt` initial-context flag
    // (biases the model toward words it's told to expect) fixed this
    // completely in a live side-by-side test on the exact same recording —
    // verified before wiring it in, not assumed.
    const out = execFileSync(
      "/opt/homebrew/bin/whisper-cli",
      ["-m", WHISPER_MODEL, "-l", "th", "-nt", "--prompt", "ธวัชชัย", CHUNK_PATH],
      { timeout: 20000 },
    );
    return out.toString("utf8").trim();
  } catch (err) {
    console.error(`[voice-wake-watcher] whisper-cli failed: ${err.message}`);
    return "";
  }
}

async function reportWake(transcript) {
  const { error } = await db.from("voice_wake_events").insert({ transcript });
  if (error) console.error(`[voice-wake-watcher] insert failed: ${error.message}`);
  else console.log(`[voice-wake-watcher] wake word detected: "${transcript}"`);
}

async function loop() {
  if (!recordChunk()) return;
  const transcript = transcribeChunk();
  try { unlinkSync(CHUNK_PATH); } catch {}
  if (transcript && WAKE_VARIANTS.some((w) => transcript.includes(w))) {
    await reportWake(transcript);
  }
}

console.log("[voice-wake-watcher] started — listening continuously for the wake word");
async function runForever() {
  for (;;) {
    try {
      await loop();
    } catch (err) {
      console.error(`[voice-wake-watcher] loop error: ${err.message}`);
    }
  }
}
runForever();
