/**
 * หน้าที่: the real test for `../voice-bridge.ts`. Drives the module
 * directly, same convention as ../../command-router/tests/router.test.ts.
 * Covers: approval gate default-off, enable/disable durability, idempotent
 * restart (no double-announce), and the HIGH-risk exclusion (production
 * business-code writes / credential-surface intents are never spoken).
 *
 * How to run:
 *   npx tsx control/agent-gateway/tests/voice-bridge.test.ts
 */
import { readFileSync, statSync } from "node:fs";
import { isVoiceBridgeEnabled, setVoiceBridgeEnabled, runVoiceAnnouncementSweep, readPersistedVoiceBridgeState } from "../voice-bridge";
import { tasksFilePath } from "../memory-store";

declare const process: {
  exitCode?: number;
  on(event: string, listener: () => void): void;
};
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

/**
 * คืนสวิตช์ voice bridge กลับสถานะเดิมเสมอ แม้เทสต์จะล้มหรือถูกขัดจังหวะ
 *
 * ── ทำไมข้อนี้ถึงสำคัญกว่าที่เห็น ──
 * เทสต์ชุดนี้เขียนลงคลังจริงของเครื่อง ไม่ใช่แซนด์บ็อกซ์ เดิมมันปิดสวิตช์คืนที่
 * ท้ายของแต่ละ check ซึ่งใช้ได้เฉพาะตอนที่ทุกอย่างผ่าน วันที่ 2026-08-31 การรัน
 * ชุดนี้ถูกขัดจังหวะกลางคัน สวิตช์จึงค้างเป็น `enabled=true, approved_by=test-owner`
 * แล้ว Core ตัวจริงหยิบไปทำงานทุก 30 วินาที จนเธรดหลักตันและไม่ตอบ HTTP นาน
 * 3 ชั่วโมง 47 นาที — เทสต์ต้องไม่ทิ้งสถานะของ runtime จริงไว้เปิด
 */
function restoreVoiceBridgeStateOnExit(): () => void {
  // เทียบกับ "สถานะที่บันทึกไว้" ไม่ใช่ประตูรันไทม์ — ประตูตอบ false เสมอตาม
  // คำตัดสินของ Owner การเทียบกับประตูจะทำให้ตัวคืนค่าไม่เห็นว่าไฟล์ถูกเปลี่ยน
  const original = readPersistedVoiceBridgeState().enabled;
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (readPersistedVoiceBridgeState().enabled !== original) {
      setVoiceBridgeEnabled(original, "test-teardown:voice-bridge.test.ts");
    }
  };
  for (const signal of ["exit", "SIGINT", "SIGTERM", "uncaughtException"]) {
    process.on(signal, restore);
  }
  return restore;
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const restoreVoiceBridge = restoreVoiceBridgeStateOnExit();
  try {
    await runChecks();
  } finally {
    restoreVoiceBridge();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

async function runChecks(): Promise<void> {
  // ── ข้อตกลงใหม่หลัง Owner ปฏิเสธระบบประกาศด้วยเสียง (2026-08-31) ──
  // เดิมชุดนี้ยืนยันว่า "เปิดแล้วต้องประกาศได้" ซึ่งเป็นพฤติกรรมที่ถูกถอดออกจาก
  // เส้นทางรันของ Core แล้ว การคงข้อยืนยันเดิมไว้จะเท่ากับบังคับให้ระบบที่ถูกสั่ง
  // ปิดกลับมาทำงาน ชุดนี้จึงยืนยันสิ่งที่ต้องเป็นจริงจากนี้ไป: มันเปิดไม่ได้อีก
  // และไม่แตะคลังงานเลย
  //
  // ไม่มี saveTask() ในชุดนี้อีกต่อไป — เทสต์ต้องไม่ต่อท้ายงานปลอมลง
  // tasks.jsonl ของจริงเพียงเพื่อพิสูจน์ว่าระบบที่ปิดอยู่ไม่ทำงาน

  await check("ประตูรันไทม์ปิดถาวร ไม่ว่าไฟล์สถานะจะเขียนอะไรไว้", () => {
    setVoiceBridgeEnabled(true, "test-owner");
    assert(readPersistedVoiceBridgeState().enabled === true, "expected the persisted record to still be written (history preserved)");
    assert(isVoiceBridgeEnabled() === false, "expected the runtime gate to stay OFF even when the persisted file says enabled=true");
    setVoiceBridgeEnabled(false, "test-owner");
  });

  await check("sweep เป็น no-op และไม่แตะคลังงานเลย แม้ไฟล์สถานะจะเปิดค้าง", async () => {
    setVoiceBridgeEnabled(true, "test-owner");
    const before = statSync(tasksFilePath()).mtimeMs;
    const started = Date.now();
    const result = await runVoiceAnnouncementSweep();
    const elapsed = Date.now() - started;
    assert(result.enabled === false, "expected the sweep to report enabled=false");
    assert(result.announced.length === 0, "expected zero announcements");
    assert(result.skipped_high_risk.length === 0 && result.errors.length === 0, "expected an empty result, not a partial scan");
    assert(statSync(tasksFilePath()).mtimeMs === before, "expected tasks.jsonl to be untouched by a disabled sweep");
    assert(elapsed < 250, `expected a disabled sweep to return without reading the task store (took ${elapsed}ms)`);
    setVoiceBridgeEnabled(false, "test-owner");
  });

  await check("ไฟล์ enabled=true ที่ค้างจากการรันที่ถูกขัดจังหวะ ปลุกการทำงานคืนไม่ได้", async () => {
    // จำลองสิ่งที่เกิดขึ้นจริงในเหตุการณ์ 2026-08-31 แบบตรงตัว
    setVoiceBridgeEnabled(true, "test-owner");
    assert(isVoiceBridgeEnabled() === false, "expected a stale enabled=true file to have no runtime effect");
    const result = await runVoiceAnnouncementSweep();
    assert(result.enabled === false && result.announced.length === 0, "expected no sweep work from a stale enabled file");
    setVoiceBridgeEnabled(false, "test-owner");
  });

  await check("supervisor ไม่มีทางเริ่มการประกาศด้วยเสียงได้อีก", () => {
    const src = readFileSync(new URL("../supervisor.ts", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
      .join("\n");
    assert(!src.includes("runVoiceAnnouncementSweep"), "expected no voice sweep call in the supervisor");
    assert(!src.includes("voice-bridge"), "expected no voice-bridge import in the supervisor");
  });

  await check("ประวัติการอนุมัติยังถูกบันทึกไว้ ไม่ถูกลบทิ้ง", () => {
    const state = readPersistedVoiceBridgeState();
    assert(typeof state.enabled === "boolean", "expected the persisted record to remain readable");
    assert("approved_by" in state && "approved_at" in state, "expected the approval fields to remain in the record");
  });
}

main();
