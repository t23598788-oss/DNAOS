/**
 * CASE 1–16: การเก็บผลสังเกตรันไทม์แบบมีชนิด
 *
 * ── บทเรียนจากเหตุการณ์ 2026-08-29 ──
 * เทสต์รุ่นก่อนตั้ง `MACHINE_OBSERVATION_DATA_DIR` ไว้บนสุดของไฟล์แล้วคิดว่า
 * ปลอดภัย แต่ ESM ยก `import` ขึ้นก่อน ค่าจึงถูกตั้งหลังโมดูลอ่าน path ไปแล้ว
 * เทสต์เขียนลงหลักฐานจริงและ chmod ไฟล์จริง จนหลักฐาน 187 แถวหายถาวร
 *
 * ไฟล์นี้จึงไม่พึ่งลำดับ import อีก: `observation-store.ts` resolve path ตอน
 * เรียกใช้แล้ว และเทสต์ **ยืนยันด้วยตัวเองก่อนเขียนอะไรลงไป** ว่า path ที่กำลัง
 * ใช้อยู่ในไดเรกทอรีชั่วคราวจริง ถ้าไม่ใช่ จะหยุดทันทีโดยไม่เขียนอะไรเลย
 *
 * ความล้มเหลวของการเก็บถูกฉีดผ่าน `deps.append` — ไม่มีการทำให้ระบบไฟล์จริงพัง
 */
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistRuntimeObservation } from "../target-observer";
import type { RuntimeObservationResult } from "../target-observer";
import { readObservations, observationStoreFile, OBSERVATION_STORE_FILE } from "../observation-store";
import type { ObservationRecord } from "../observation-store";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}`); if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`); }
};

// ตั้ง override *หลัง* import แล้วพิสูจน์ว่ามีผลจริง — หัวใจของการซ่อม
const SANDBOX = mkdtempSync(join(tmpdir(), "dna-obs-test-"));
process.env.MACHINE_OBSERVATION_DATA_DIR = SANDBOX;

const active = observationStoreFile();
check("ISOLATION  override ที่ตั้งหลัง import มีผลต่อ path ที่ใช้จริง", active.startsWith(SANDBOX), { active, SANDBOX });
check("ISOLATION  path ที่ใช้จริงไม่ใช่สโตร์ production",
  active !== OBSERVATION_STORE_FILE && !active.includes("control/machine-observation/data"), active);
if (!active.startsWith(SANDBOX)) {
  console.log("\nหยุดทันที: การแยกสโตร์ล้มเหลว จะไม่เขียนอะไรทั้งสิ้น");
  console.log(`${pass} passed, ${fail + 1} failed`);
  process.exit(1);
}

function measurement(overrides: Partial<RuntimeObservationResult> = {}): RuntimeObservationResult {
  return {
    runtime_target_id: "rt-test-0001",
    capability_id: "capability-test-0001",
    observed_at: "2026-08-28T18:00:00.000Z",
    pid: 4242,
    started_at: "Fri Aug 28 20:00:00 2026",
    uptime_seconds: 3600,
    listening_pids: [4242],
    health: { url: "http://127.0.0.1:8791/health", http_status: 200, expected_status: 200, healthy: true, error: null, checked_at: "2026-08-28T18:00:00.100Z" },
    unknown: [],
    authority: "OBSERVE_ONLY",
    ...overrides,
  };
}

const first = persistRuntimeObservation(measurement(), { work_id: "work-test-0001" });
check("persist สำเร็จและคืน observation_id", first.ok, first);
if (!first.ok) { console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); }

const rec = readObservations().find((r) => r.event_id === first.observation_id) as ObservationRecord | undefined;
check("อ่านแถวกลับมาได้ด้วย observation_id", Boolean(rec));
const m = rec?.runtime_measurement;

check("CASE 1  pid/uptime/health เป็นค่าที่มีชนิด ไม่ใช่ข้อความ",
  typeof m?.pid === "number" && m?.pid === 4242
  && typeof m?.uptime_seconds === "number" && m?.uptime_seconds === 3600
  && typeof m?.health?.healthy === "boolean",
  { pid: m?.pid, uptime: m?.uptime_seconds, healthy: m?.health?.healthy });
check("CASE 2  runtime_target_id ตรงเป๊ะ", rec?.runtime_target_id === "rt-test-0001" && m?.runtime_target_id === "rt-test-0001", rec?.runtime_target_id);
check("CASE 3  capability_id ตรงเป๊ะ", rec?.capability_id === "capability-test-0001" && m?.capability_id === "capability-test-0001", rec?.capability_id);
check("CASE 4  observed_at ตรงเป๊ะ", rec?.observed_at === "2026-08-28T18:00:00.000Z" && m?.observed_at === "2026-08-28T18:00:00.000Z", rec?.observed_at);
check("CASE 5  listening_pids เป็นตัวเลข", Array.isArray(m?.listening_pids) && typeof m?.listening_pids?.[0] === "number", m?.listening_pids);
check("CASE 6  health อ่านได้โดยไม่ parse ข้อความ",
  m?.health?.http_status === 200 && m?.health?.expected_status === 200 && m?.health?.healthy === true && m?.health?.error === null, m?.health);

const withUnknown = persistRuntimeObservation(measurement({ runtime_target_id: "rt-test-0002", pid: null, uptime_seconds: null, health: null, unknown: ["ไม่มีโปรเซสใดฟังพอร์ต 9999"] }));
const unkRec = withUnknown.ok ? readObservations().find((r) => r.event_id === withUnknown.observation_id) : undefined;
check("CASE 7  unknown[] ครบ และค่าที่วัดไม่ได้เป็น null ไม่ใช่ 0",
  unkRec?.runtime_measurement?.unknown.length === 1
  && unkRec?.runtime_measurement?.pid === null
  && unkRec?.runtime_measurement?.uptime_seconds === null, unkRec?.runtime_measurement?.unknown);
check("CASE 8  authority ยังเป็น OBSERVE_ONLY", m?.authority === "OBSERVE_ONLY", m?.authority);

const second = persistRuntimeObservation(measurement({ observed_at: "2026-08-28T19:00:00.000Z", pid: 5555, uptime_seconds: 60 }), { work_id: "work-test-0002" });
const after = readObservations();
const firstAgain = after.find((r) => r.event_id === (first.ok ? first.observation_id : ""));
check("CASE 9  วัดซ้ำได้แถวใหม่ แถวเดิมไม่ถูกแก้ (append-only)",
  second.ok && after.length >= 3
  && firstAgain?.runtime_measurement?.pid === 4242
  && firstAgain?.runtime_measurement?.uptime_seconds === 3600,
  { total: after.length, first_pid: firstAgain?.runtime_measurement?.pid });

check("       work_id ของผู้เรียกติดไปกับหลักฐาน", rec?.work_id === "work-test-0001", rec?.work_id);

// CASE 16 — ฉีดความล้มเหลวที่ขอบเขต persistence ไม่แตะระบบไฟล์จริง
{
  const before = readObservations().length;
  const outcome = persistRuntimeObservation(measurement({ runtime_target_id: "rt-test-fail" }), {},
    { append: () => { throw new Error("injected persistence failure"); } });
  const afterCount = readObservations().length;
  check("CASE 16 เก็บไม่สำเร็จ -> ไม่คืน observation id และไม่มีแถวใหม่",
    !outcome.ok && outcome.reason_code === "PERSIST_FAILED"
    && !("observation_id" in outcome)
    && afterCount === before
    && !readObservations().some((r) => r.runtime_target_id === "rt-test-fail"),
    { ok: outcome.ok, before, afterCount });
  check("CASE 16 ไม่มีสถานะ VERIFIED ถูกสร้างจากความล้มเหลว",
    !JSON.stringify(outcome).toLowerCase().includes("verified"), outcome);
}

// สโตร์ที่สองในโปรเซสเดียวกัน — พิสูจน์ว่า call-time binding ใช้ได้จริงหลายครั้ง
{
  const SANDBOX2 = mkdtempSync(join(tmpdir(), "dna-obs-test2-"));
  process.env.MACHINE_OBSERVATION_DATA_DIR = SANDBOX2;
  const isolated = persistRuntimeObservation(measurement({ runtime_target_id: "rt-test-second-dir" }));
  const inSecond = readObservations();
  process.env.MACHINE_OBSERVATION_DATA_DIR = SANDBOX;
  const backInFirst = readObservations();
  check("ISOLATION  สลับไดเรกทอรีกลางโปรเซสได้ และสองสโตร์ไม่ปนกัน",
    isolated.ok
    && observationStoreFile().startsWith(SANDBOX)
    && inSecond.length === 1
    && !backInFirst.some((r) => r.runtime_target_id === "rt-test-second-dir"),
    { second_rows: inSecond.length, first_rows: backInFirst.length });
}

check("       record_type ยังเป็น MACHINE_OBSERVATION", rec?.record_type === "MACHINE_OBSERVATION", rec?.record_type);
check("       ไม่มีฟิลด์ใดในแถวที่แปลว่า verified", !JSON.stringify(rec ?? {}).includes("verified"));
check("       ไฟล์ในแซนด์บ็อกซ์อ่านกลับเป็น JSON ได้ทุกแถว",
  existsSync(active) && readFileSync(active, "utf-8").split("\n").filter((l) => l.trim()).every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
