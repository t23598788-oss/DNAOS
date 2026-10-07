/**
 * CASE 1–18: ตัวตนผู้ขอของ runtime operation
 *
 * ── เทสต์นี้ไม่เรียก launchctl และไม่แตะบริการจริงแม้แต่ครั้งเดียว ──
 * `runOperation` เปลี่ยนสถานะเครื่องจริง การเรียกมันในเทสต์คือการรีสตาร์ทบริการ
 * production เพื่อให้เทสต์เขียว ซึ่งไม่ใช่การพิสูจน์ เทสต์นี้จึงพิสูจน์ที่ชั้นที่
 * ตัดสินจริง: ตัวประกอบ provenance, ตัวอ่านแถวย้อนหลัง, และการเขียน/อ่านสโตร์ผ่าน
 * `appendEvidence` เดียวกับที่ของจริงใช้ โดยชี้ไปที่ไดเรกทอรีชั่วคราว
 *
 * ── บทเรียนจาก 2026-08-28 ──
 * เทสต์ยืนยัน **ด้วยตัวเองก่อนเขียนอะไรลงไป** ว่า path ที่กำลังใช้อยู่ในแซนด์บ็อกซ์
 * ถ้าไม่ใช่ จะหยุดทันทีโดยไม่เขียนอะไรเลย และไม่ chmod ไฟล์จริงเป็นอันขาด
 */
import { mkdtempSync, readFileSync, existsSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRequesterProvenance, readRequester, RUNTIME_CONTROL_EXECUTOR } from "../requester";
import type { RuntimeOperationRequest } from "../requester";
import { appendEvidence, evidenceStoreFile } from "../host-runtime";
import type { OperationEvidence } from "../types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}`); if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`); }
};

// ---- การแยกสโตร์ ต้องพิสูจน์ก่อนเขียนแถวแรก ------------------------------
const PROD_STORE = join(process.cwd(), "control/runtime-control/data/operations.jsonl");
const prodBefore = existsSync(PROD_STORE) ? readFileSync(PROD_STORE, "utf-8").length : -1;

const SANDBOX = mkdtempSync(join(tmpdir(), "dna-runtime-op-"));
process.env.RUNTIME_CONTROL_DATA_DIR = SANDBOX;
const active = evidenceStoreFile();
check("ISOLATION  override ที่ตั้งหลัง import มีผลต่อ path ที่ใช้จริง", active.startsWith(SANDBOX), { active, SANDBOX });
check("ISOLATION  path ที่ใช้จริงไม่ใช่สโตร์ production", active !== PROD_STORE, active);
if (!active.startsWith(SANDBOX)) {
  console.log("\nหยุดทันที: การแยกสโตร์ล้มเหลว จะไม่เขียนอะไรทั้งสิ้น");
  console.log(`${pass} passed, ${fail + 1} failed`);
  process.exit(1);
}

const readSandbox = (): OperationEvidence[] =>
  (existsSync(active) ? readFileSync(active, "utf-8").split("\n") : [])
    .filter((l) => l.trim()).map((l) => JSON.parse(l) as OperationEvidence);

function evidence(overrides: Partial<OperationEvidence> = {}): OperationEvidence {
  return {
    operation_id: "op-test-0001", service_id: "deadboard" as never, launchd_label: "com.dnaos.test",
    requested_action: "restart" as never, port: 9999, pid_before: 1, pid_after: 2,
    launchd_loaded_before: true, launchd_loaded_after: true,
    health_before: { healthy: true, http_status: 200, error: null } as never,
    health_after: { healthy: true, http_status: 200, error: null } as never,
    duplicate_check: { listening_pids: [2], duplicate_detected: false } as never,
    readiness_wait_ms: 0, readiness_deadline_ms: 5000,
    timestamp_started: "2026-08-29T00:00:00.000Z", timestamp_completed: "2026-08-29T00:00:01.000Z",
    result: "SUCCESS" as never, failure_reason: null,
    ...overrides,
  };
}

const OWNER_REQUEST: RuntimeOperationRequest = {
  requested_by: { identity_id: "owner", kind: "human" },
  lineage: { work_id: "work-abc", command_id: "cmd-abc", correlation_id: "corr-abc", owner_intent_id: "intent-abc" },
};
const RECOVERY_REQUEST: RuntimeOperationRequest = {
  requested_by: { identity_id: "identity-recovery-supervisor", kind: "service" },
  lineage: { work_id: "work-recovery-deadboard-1", condition_id: "cond-1", action_id: "action-1" },
};

// ---- CASE 1–3: สาย Owner --------------------------------------------------
const ownerRow = evidence({ operation_id: "op-owner", ...buildRequesterProvenance(OWNER_REQUEST) });
appendEvidence(ownerRow);
const ownerBack = readSandbox().find((r) => r.operation_id === "op-owner");
check("CASE 1  คำสั่ง Owner ที่เปลี่ยนสถานะ -> หลักฐานมีตัวตนมนุษย์ตรงเป๊ะ",
  ownerBack?.requested_by?.identity_id === "owner" && ownerBack?.requested_by?.kind === "human", ownerBack?.requested_by);
check("CASE 2  lineage ของ Owner ครบทุก id ที่มีจริง",
  ownerBack?.requester_lineage?.work_id === "work-abc"
  && ownerBack?.requester_lineage?.command_id === "cmd-abc"
  && ownerBack?.requester_lineage?.correlation_id === "corr-abc"
  && ownerBack?.requester_lineage?.owner_intent_id === "intent-abc", ownerBack?.requester_lineage);
check("CASE 3  ช่อง lineage ที่ไม่มีจริง ไม่ถูกใส่เป็น null",
  ownerBack !== undefined && !("condition_id" in (ownerBack.requester_lineage ?? {})), ownerBack?.requester_lineage);

// ---- CASE 4–6: สายกู้คืน ---------------------------------------------------
const recoveryRow = evidence({ operation_id: "op-recovery", ...buildRequesterProvenance(RECOVERY_REQUEST) });
appendEvidence(recoveryRow);
const recBack = readSandbox().find((r) => r.operation_id === "op-recovery");
check("CASE 4  การกู้คืน -> หลักฐานมีตัวตนแบบ service ตรงเป๊ะ",
  recBack?.requested_by?.identity_id === "identity-recovery-supervisor" && recBack?.requested_by?.kind === "service", recBack?.requested_by);
check("CASE 5  lineage ของการกู้คืนเก็บ condition/action ไว้ครบ",
  recBack?.requester_lineage?.condition_id === "cond-1" && recBack?.requester_lineage?.action_id === "action-1", recBack?.requester_lineage);
check("CASE 6  Owner กับการกู้คืนแยกออกจากกันแบบกำหนดผลได้ ทั้ง id และ kind",
  ownerBack?.requested_by?.identity_id !== recBack?.requested_by?.identity_id
  && ownerBack?.requested_by?.kind === "human" && recBack?.requested_by?.kind === "service",
  { owner: ownerBack?.requested_by, recovery: recBack?.requested_by });

// ---- CASE 7–9: ไม่มีผู้ขอ = NOT_MEASURED ไม่ใช่ตัวตนที่แต่งขึ้น --------------
const anonRow = evidence({ operation_id: "op-anon", ...buildRequesterProvenance(undefined) });
appendEvidence(anonRow);
const anonBack = readSandbox().find((r) => r.operation_id === "op-anon");
check("CASE 7  ไม่ส่งผู้ขอ -> ฟิลด์หายไปทั้งหมด ไม่ปรากฏในแถว",
  anonBack !== undefined && !("requested_by" in anonBack) && !("requester_lineage" in anonBack) && !("executed_by" in anonBack),
  Object.keys(anonBack ?? {}).filter((k) => k.startsWith("request") || k === "executed_by"));
const anonRead = readRequester(anonBack as never);
check("CASE 8  อ่านแล้วได้ NOT_MEASURED ไม่ใช่ OWNER/SYSTEM/UNKNOWN/RECOVERY",
  !anonRead.measured && anonRead.reason_code === "NOT_MEASURED"
  && !/OWNER|SYSTEM|UNKNOWN|RECOVERY/.test(JSON.stringify(anonBack ?? {})), anonRead);
const emptyId = buildRequesterProvenance({ requested_by: { identity_id: "", kind: "human" } });
check("CASE 9  identity_id ว่าง = ไม่มีผู้ขอ ไม่ใช่ผู้ขอไร้ชื่อ", Object.keys(emptyId).length === 0, emptyId);

// ---- CASE 10: แถวเก่าที่ไม่มีฟิลด์เลย อ่านได้ --------------------------------
const legacyLine = '{"operation_id":"op-legacy","service_id":"deadboard","requested_action":"restart","result":"SUCCESS"}';
appendFileSync(active, legacyLine + "\n", "utf-8");
const legacy = readSandbox().find((r) => r.operation_id === "op-legacy");
const legacyRead = readRequester(legacy as never);
check("CASE 10 แถวเก่าที่ไม่มีฟิลด์ผู้ขอ อ่านได้และเป็น NOT_MEASURED",
  legacy !== undefined && !legacyRead.measured && legacyRead.reason_code === "NOT_MEASURED", legacyRead);

// ---- CASE 11: ปฏิบัติการที่ล้มเหลว ยังเก็บผู้ขอไว้ แต่ไม่อนุมานเจตนา ------------
const failedRow = evidence({ operation_id: "op-failed", result: "FAILED" as never, failure_reason: "no PID after restart", ...buildRequesterProvenance(OWNER_REQUEST) });
appendEvidence(failedRow);
const failBack = readSandbox().find((r) => r.operation_id === "op-failed");
check("CASE 11 ล้มเหลว -> ยังมีผู้ขอครบ และไม่มีการอนุมานสถานะที่พึงเป็น",
  failBack?.requested_by?.identity_id === "owner" && failBack?.result === "FAILED"
  && !/desired_state|desired-state|intended_state/i.test(JSON.stringify(failBack ?? {})), failBack?.requested_by);

// ---- CASE 12: health/status ไม่กลายเป็นเจตนา --------------------------------
const healthRow = evidence({ operation_id: "op-health", requested_action: "health" as never, ...buildRequesterProvenance(OWNER_REQUEST) });
appendEvidence(healthRow);
const healthBack = readSandbox().find((r) => r.operation_id === "op-health");
check("CASE 12 health มีผู้ขอได้ แต่ไม่มีฟิลด์ใดแปลว่าเจตนา/สถานะที่พึงเป็น",
  healthBack?.requested_action === "health" && healthBack?.requested_by?.identity_id === "owner"
  && !/desired|intent_state|should_be/i.test(JSON.stringify(healthBack ?? {})), healthBack?.requested_action);

// ---- CASE 13–14: ผู้เรียกเปลี่ยนผู้ลงมือไม่ได้ ---------------------------------
const spoof = buildRequesterProvenance(
  { requested_by: { identity_id: "owner", kind: "human" }, executed_by: "attacker" } as unknown as RuntimeOperationRequest,
);
check("CASE 13 ผู้เรียกยัด executed_by มาไม่ได้ ค่าคงเป็น runtime-control",
  spoof.executed_by === RUNTIME_CONTROL_EXECUTOR && spoof.executed_by === "control/runtime-control", spoof.executed_by);
check("CASE 14 ผู้ขอ != ผู้ลงมือ ในแถวเดียวกัน",
  ownerBack?.executed_by === "control/runtime-control" && ownerBack?.requested_by?.identity_id !== ownerBack?.executed_by,
  { requested_by: ownerBack?.requested_by?.identity_id, executed_by: ownerBack?.executed_by });

// ---- CASE 15–16: การยืนยันเชิงลบเรื่องอำนาจ ------------------------------------
const surface = JSON.stringify([ownerRow, recoveryRow, spoof, readRequester(ownerBack as never)]);
check("CASE 15 การบันทึกตัวตน ไม่สร้างความหมายเชิงอนุมัติใด ๆ",
  !/authoriz|approved|permitted|granted|allow|verdict/i.test(surface));
check("CASE 16 ไม่มีการอนุมานสถานะที่พึงเป็นที่ใดเลยในผิวสัมผัสนี้",
  !/desired_state|desiredState|deriveRuntimeDesiredState/i.test(surface));

// ---- CASE 17–18: สโตร์ production ไม่ถูกแตะ ------------------------------------
const prodAfter = existsSync(PROD_STORE) ? readFileSync(PROD_STORE, "utf-8").length : -1;
const prodText = prodBefore >= 0 ? readFileSync(PROD_STORE, "utf-8") : "";
check("CASE 17 สโตร์ production ไม่มีแถวทดสอบของไฟล์นี้แม้แต่แถวเดียว",
  !prodText.includes("op-owner") && !prodText.includes("op-recovery") && !prodText.includes("op-anon")
  && !prodText.includes("op-legacy") && !prodText.includes("com.dnaos.test"));
check("CASE 18 สโตร์ production โตได้จาก daemon ที่รันอยู่เท่านั้น ไม่หดและไม่ถูกตัด",
  prodAfter >= prodBefore, { prodBefore, prodAfter });

console.log(`\nแซนด์บ็อกซ์: ${active}  (${readSandbox().length} แถว)`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
