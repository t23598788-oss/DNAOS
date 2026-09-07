/**
 * CASE A–O: หลักฐานของ boot ต้องมาจากสิ่งที่วัดได้จริงทุกช่อง
 *
 * ── ไม่มี launchctl จริงในไฟล์นี้ ──
 * ทุกจุดที่ boot แตะระบบปฏิบัติการถูกฉีดของปลอมผ่าน `BootDeps` การพิสูจน์
 * พฤติกรรม boot ด้วยการ bootstrap/kickstart บริการ production จริงไม่ใช่การพิสูจน์
 * มันคือการรีสตาร์ทระบบเพื่อให้เทสต์เขียว ตัวนับด้านล่างพิสูจน์ว่าฟังก์ชันจริง
 * ไม่เคยถูกเรียกเลยแม้แต่ครั้งเดียว
 *
 * ── การแยกสโตร์ถูกยืนยันก่อนเขียนแถวแรก ──
 * บทเรียน 2026-08-28 หลักฐาน 187 แถวหายเพราะ path ถูกผูกตอน import
 */
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootAll, resolveStartOrder } from "../boot-orchestrator";
import type { BootDeps } from "../boot-orchestrator";
import { evidenceStoreFile } from "../host-runtime";
import { readRequester } from "../requester";
import type { OperationEvidence, ServiceId } from "../types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}`); if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`); }
};

// ---- การแยกสโตร์: ยืนยันก่อนเขียน ----------------------------------------
const PROD_OPS = join(process.cwd(), "control/runtime-control/data/operations.jsonl");
const PROD_OBS = join(process.cwd(), "control/machine-observation/data/observations.jsonl");
const opsBefore = existsSync(PROD_OPS) ? readFileSync(PROD_OPS, "utf-8").length : -1;
const obsBefore = existsSync(PROD_OBS) ? readFileSync(PROD_OBS, "utf-8") : "";

const SANDBOX = mkdtempSync(join(tmpdir(), "dna-boot-"));
process.env.RUNTIME_CONTROL_DATA_DIR = SANDBOX;
const activePath = evidenceStoreFile();
check("ISOLATION  path หลักฐานที่ใช้จริงอยู่ในแซนด์บ็อกซ์", activePath.startsWith(SANDBOX), { activePath, SANDBOX });
if (!activePath.startsWith(SANDBOX)) {
  console.log("\nหยุดทันที: การแยกสโตร์ล้มเหลว จะไม่เขียนอะไรทั้งสิ้น");
  console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1);
}

// ---- โครงจำลอง OS -------------------------------------------------------
interface Fake {
  deps: BootDeps; rows: OperationEvidence[];
  calls: { bootstrap: number; kickstart: number };
}
function fake(opts: {
  loaded: boolean; pid: number | null;
  /** ลำดับ http_status ที่ probe จะได้รับ ค่าสุดท้ายถูกใช้ซ้ำเมื่อหมด */
  statuses: (number | null)[];
  /** ms ที่เดินไปต่อหนึ่งครั้งที่อ่านนาฬิกา */
  tickMs?: number;
  loadedAfterMutation?: boolean; pidAfterMutation?: number | null;
  throwOnMutate?: boolean;
}): Fake {
  const rows: OperationEvidence[] = [];
  const calls = { bootstrap: 0, kickstart: 0 };
  let loaded = opts.loaded, pid = opts.pid, probeIndex = 0, clock = 1_000_000, wall = 0;
  const tick = opts.tickMs ?? 250;
  const deps: BootDeps = {
    bootstrap: () => {
      calls.bootstrap += 1;
      if (opts.throwOnMutate) throw new Error("launchctl bootstrap refused (จำลอง)");
      loaded = opts.loadedAfterMutation ?? true; pid = opts.pidAfterMutation ?? 4242;
      return { ok: true, error: null };
    },
    kickstart: () => {
      calls.kickstart += 1;
      if (opts.throwOnMutate) throw new Error("launchctl kickstart refused (จำลอง)");
      loaded = opts.loadedAfterMutation ?? true; pid = opts.pidAfterMutation ?? 4242;
      return { ok: true, error: null };
    },
    launchdState: () => ({ loaded, pid, last_exit_status: null } as never),
    healthCheck: async () => {
      const status = opts.statuses[Math.min(probeIndex, opts.statuses.length - 1)];
      probeIndex += 1;
      return { checked_at: `2026-08-29T00:00:${String(wall).padStart(2, "0")}.000Z`, http_status: status, healthy: status !== null && status >= 200 && status < 400, error: status === null ? "connection refused (จำลอง)" : null };
    },
    append: (e) => { rows.push(JSON.parse(JSON.stringify(e)) as OperationEvidence); },
    now: () => { wall += 1; return `2026-08-29T00:00:${String(wall).padStart(2, "0")}.000Z`; },
    elapsedMs: () => { clock += tick; return clock; },
    sleep: async () => { clock += 1000; },
  };
  return { deps, rows, calls };
}
const ONLY: readonly ServiceId[] = ["deadboard"];

async function main(): Promise<void> {
  // ---- CASE A: ดีอยู่แล้ว -> ไม่แตะอะไรเลย -------------------------------------
  {
    const f = fake({ loaded: true, pid: 111, statuses: [200] });
    await bootAll({ only: ONLY, deps: f.deps });
    const row = f.rows[0];
    check("CASE A  ดีอยู่แล้ว -> health_before.healthy = true (ไม่ใช่ false ที่เขียนตายตัว)",
      row?.health_before.healthy === true && row.health_before.http_status === 200 && row.health_before.error === null, row?.health_before);
    check("CASE A  ดีอยู่แล้ว -> ไม่ bootstrap ไม่ kickstart และ action ไม่ใช่ start",
      f.calls.bootstrap === 0 && f.calls.kickstart === 0 && row?.requested_action === "health",
      { ...f.calls, action: row?.requested_action });
    check("CASE A  ไม่มีคำว่า pre-boot probe หลงเหลือในหลักฐานใหม่",
      !JSON.stringify(f.rows).includes("pre-boot probe"));
  }

  // ---- CASE B: loaded=true, pid=null ---------------------------------------
  {
    const f = fake({ loaded: true, pid: null, statuses: [null, 200] });
    await bootAll({ only: ONLY, deps: f.deps });
    const row = f.rows[0];
    check("CASE B  loaded=true + pid=null -> launchd_loaded_before = true",
      row?.launchd_loaded_before === true && row.pid_before === null,
      { loaded_before: row?.launchd_loaded_before, pid_before: row?.pid_before });
    check("CASE B  โหลดอยู่แล้ว -> ใช้ kickstart ไม่ใช่ bootstrap", f.calls.kickstart === 1 && f.calls.bootstrap === 0, f.calls);
  }

  // ---- CASE C: duplicate ไม่ได้วัด ------------------------------------------
  {
    const f = fake({ loaded: false, pid: null, statuses: [null, 200] });
    await bootAll({ only: ONLY, deps: f.deps });
    check("CASE C  duplicate_check = NOT_MEASURED (ช่องหายไป) ไม่ใช่ false",
      f.rows.every((r) => !("duplicate_check" in r)),
      f.rows.map((r) => r.duplicate_check));
    check("CASE C  ไม่มี listening_pids ที่ถูกแต่งจาก pid_after",
      !JSON.stringify(f.rows).includes("listening_pids"));
  }

  // ---- CASE D/F: readiness สำเร็จ = ระยะเวลาที่วัดได้จริง -------------------------
  {
    const f = fake({ loaded: false, pid: null, statuses: [null, null, 200], tickMs: 250 });
    await bootAll({ only: ONLY, deps: f.deps });
    const row = f.rows[0];
    // นาฬิกาเดิน 250ms ต่อการอ่านหนึ่งครั้ง + 1000ms ต่อการหลับหนึ่งครั้ง
    check("CASE D  readiness_wait_ms เท่ากับระยะเวลาที่วัดได้จริง ไม่ใช่ค่า timeout ที่ตั้งไว้",
      typeof row?.readiness_wait_ms === "number" && row.readiness_wait_ms > 0
      && row.readiness_wait_ms !== row.readiness_deadline_ms,
      { wait: row?.readiness_wait_ms, deadline: row?.readiness_deadline_ms });
    check("CASE F  timestamp_started ถูกจับก่อนช่วงการรอ และ <= timestamp_completed",
      row !== undefined && row.timestamp_started < row.timestamp_completed
      && row.timestamp_started <= row.health_after.checked_at,
      { started: row?.timestamp_started, health_at: row?.health_after.checked_at, completed: row?.timestamp_completed });
  }

  // ---- CASE E/H: ล้มเหลวทุกครั้ง -> แถวต่อความพยายาม -----------------------------
  {
    const f = fake({ loaded: false, pid: null, statuses: [null], tickMs: 6000 });
    const report = await bootAll({ only: ONLY, deps: f.deps });
    const ids = f.rows.map((r) => r.operation_id);
    const corr = f.rows.map((r) => r.requester_lineage?.correlation_id);
    check("CASE E  readiness ล้มเหลว -> readiness_wait_ms คือค่าที่วัดได้ ไม่ใช่ค่า timeout ที่ตั้งไว้",
      f.rows.every((r) => r.readiness_wait_ms !== r.readiness_deadline_ms && r.readiness_wait_ms > 0),
      f.rows.map((r) => ({ wait: r.readiness_wait_ms, deadline: r.readiness_deadline_ms })));
    check("CASE E  ไม่มี SUCCESS ปลอม เมื่อ health ไม่เคยผ่าน",
      f.rows.every((r) => r.result === "FAILED") && report.results[0].state === "FAILED_LOCKED",
      { results: f.rows.map((r) => r.result), state: report.results[0].state });
    check("CASE H  รีทราย 3 ครั้ง -> operation_id ต่างกันทุกครั้ง",
      ids.length === 3 && new Set(ids).size === 3, ids);
    check("CASE H  รีทรายทุกครั้งใช้ correlation_id ของรอบ boot เดียวกัน",
      corr.length === 3 && new Set(corr).size === 1 && corr[0] === report.boot_id, { corr, boot_id: report.boot_id });
    check("CASE E  จำนวนครั้งที่ปลุกยังเป็น 3 เท่าเดิม ไม่ถูกเปลี่ยน",
      f.calls.bootstrap + f.calls.kickstart === 3 && report.results[0].attempts === 3, f.calls);
  }

  // ---- CASE G/I: ตัวตนผู้ขอ และผู้ลงมือ ------------------------------------------
  {
    const f = fake({ loaded: false, pid: null, statuses: [null, 200] });
    await bootAll({ only: ONLY, deps: f.deps });
    const row = f.rows[0];
    const read = readRequester(row as never);
    check("CASE G  ผู้ขอถูกบันทึกเป็น recovery-supervisor ในฐานะ service ตรงเป๊ะ",
      read.measured && read.identity.identity_id === "identity-recovery-supervisor" && read.identity.kind === "service", read);
    check("CASE G  ไม่มีตัวตนมนุษย์/Owner ถูกแต่งขึ้นในหลักฐาน boot",
      !/"kind":"human"/.test(JSON.stringify(f.rows)) && !/identity_id":"owner/.test(JSON.stringify(f.rows)));
    check("CASE I  ผู้ลงมือ = NOT_MEASURED (ช่องหายไป) ไม่ใช่ control/runtime-control ที่ผิดตัว",
      !("executed_by" in (row ?? {})) && !JSON.stringify(f.rows).includes("control/runtime-control"),
      row?.executed_by);
  }

  // ---- CASE J: เกณฑ์ health เฉพาะบริการไม่เปลี่ยน --------------------------------
  {
    // deadboard ประกาศ health_expect_status = 200; 204 อยู่ในช่วง 2xx แต่ไม่ตรงเกณฑ์
    const f = fake({ loaded: true, pid: 111, statuses: [204], tickMs: 6000 });
    const report = await bootAll({ only: ONLY, deps: f.deps });
    check("CASE J  204 ไม่ผ่านเกณฑ์เฉพาะบริการ (ยังใช้เกณฑ์เดิม ไม่ใช่ 2xx กว้าง)",
      report.results[0].state === "FAILED_LOCKED" && f.calls.kickstart > 0,
      { state: report.results[0].state, calls: f.calls });
  }

  // ---- CASE K: ไม่มีโหมดล้มเหลวใหม่จาก duplicate --------------------------------
  {
    const f = fake({ loaded: false, pid: null, statuses: [null, 200] });
    const report = await bootAll({ only: ONLY, deps: f.deps });
    check("CASE K  มีผู้ฟังพอร์ตกี่ตัวก็ไม่ทำให้ boot FAILED — boot ไม่ตรวจซ้ำเหมือนเดิม",
      report.results[0].state === "READY" && f.rows.some((r) => r.result === "SUCCESS"),
      report.results[0].state);
  }

  // ---- CASE L: ลำดับ dependency ไม่เปลี่ยน --------------------------------------
  {
    const { order, cyclic } = resolveStartOrder();
    const idx = (s: string): number => order.indexOf(s as ServiceId);
    check("CASE L  ลำดับยังมาจาก depends_on: joint-monitor/compute-api มาก่อน control-workspace",
      cyclic.length === 0 && idx("joint-monitor") < idx("control-workspace") && idx("compute-api") < idx("control-workspace"),
      order);
  }

  // ---- CASE: SKIPPED_DEPENDENCY ไม่ถูกยัดเป็น OperationEvidence -------------------
  {
    const f = fake({ loaded: true, pid: 111, statuses: [null], tickMs: 6000 });
    const report = await bootAll({ only: ["compute-api", "control-workspace"] as ServiceId[], deps: f.deps });
    const skipped = report.results.filter((r) => r.state === "SKIPPED_DEPENDENCY");
    check("       บริการที่ถูกข้าม ไม่สร้างแถว OperationEvidence (ไม่ได้ลงมือและไม่ได้วัด)",
      skipped.length > 0 && !f.rows.some((r) => skipped.some((s) => s.service_id === r.service_id)),
      { skipped: skipped.map((s) => s.service_id), rows: f.rows.map((r) => r.service_id) });
  }

  // ---- CASE: เขียนผ่าน appendEvidence จริงลงแซนด์บ็อกซ์ ---------------------------
  {
    const f = fake({ loaded: true, pid: 111, statuses: [200] });
    await bootAll({ only: ONLY, deps: { ...f.deps, append: undefined } });
    const written = readFileSync(activePath, "utf-8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as OperationEvidence);
    check("       ตัวเขียนหลักฐานร่วมตัวเดิมใช้ได้จริง และลงแซนด์บ็อกซ์",
      written.length === 1 && written[0].requested_by?.identity_id === "identity-recovery-supervisor"
      && !("duplicate_check" in written[0]) && !("executed_by" in written[0]),
      written[0]);
  }

  // ---- CASE M/N/O: production ไม่ถูกแตะ ------------------------------------------
  const opsAfter = existsSync(PROD_OPS) ? readFileSync(PROD_OPS, "utf-8").length : -1;
  const opsText = opsBefore >= 0 ? readFileSync(PROD_OPS, "utf-8") : "";
  check("CASE M  แถว boot เดิม 64 แถวยังอยู่ครบและไม่ถูกเขียนใหม่",
    (opsText.match(/pre-boot probe/g) ?? []).length === 64);
  check("CASE N  ไม่มีแถวของเทสต์นี้เข้าสโตร์ production และสโตร์ไม่หด",
    opsAfter === opsBefore && (opsBefore < 0 || opsText.length === opsBefore), { opsBefore, opsAfter });
  check("CASE N  สโตร์ observation ไม่ถูกแตะเลย",
    (existsSync(PROD_OBS) ? readFileSync(PROD_OBS, "utf-8") : "") === obsBefore);
  // ตรวจจากซอร์สของไฟล์นี้เอง ไม่ใช่การยืนยันลอย ๆ: ทุกการเรียก bootAll ต้องส่ง
  // deps ที่ทับ bootstrap/kickstart ถ้ามีสักจุดที่ลืม launchctl จริงจะถูกเรียก
  const selfSource = readFileSync(join(process.cwd(), "control/runtime-control/tests/boot-evidence-parity.test.ts"), "utf-8");
  const bootCalls = selfSource.match(/bootAll\(\{[^}]*\}/g) ?? [];
  check("CASE O  ไม่มีการเรียก launchctl จริง — bootAll ทุกจุดในไฟล์นี้ส่ง deps ที่ฉีดของปลอม",
    bootCalls.length > 0 && bootCalls.every((c) => c.includes("deps:")), { calls: bootCalls.length });

}

void main().then(() => {
  console.log(`\nแซนด์บ็อกซ์: ${activePath}`);
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
});
