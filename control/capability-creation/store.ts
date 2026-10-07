/**
 * หน้าที่: บันทึกสัญญาการเกิดของ capability และผลของประตูทั้งสองบาน แล้ว
 * **ส่งการเชื่อมต่อที่ยังขาดไปเข้าคิวรอปลุก** ผ่านกลไกที่มีอยู่แล้ว
 *
 * ไม่มี store ที่สองสำหรับสถานะงาน และไม่มี evaluator ที่สองสำหรับการปลุก:
 *   - ความคืบหน้าของงาน   → `control/work-session-state/` (checkpoint)
 *   - การรอ dependency     → `control/work-continuation/#appendWaiting`
 *   - ตัวตนของ capability  → Registry ผ่าน pipeline เดิม
 * ไฟล์นี้เก็บสิ่งเดียวที่ยังไม่มีเจ้าของ: **สัญญาการเกิด** ของ capability
 *
 * Input: `CapabilityCreationContract`, `CreationGateResult`.
 * Output: `recordCreationContract`, `readCreationContracts`,
 * `currentCreationContract`, `parkMissingConnections`, `creationContractPath`.
 * Dependency ที่อนุญาต: Node built-ins, ./types.ts และ contract สาธารณะของ
 * work-session-state / work-continuation / work-resolution
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเขียน evaluator/index/wake loop ที่นี่ — `control/work-continuation/`
 *   เป็นเจ้าของทั้งสามอย่าง
 * - ห้าม mint work_id — ใช้ของที่ work-session-state ใช้อยู่เท่านั้น
 * - ห้าม mint resource_id/capability_id — Registry เป็นผู้ออกให้
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CapabilityCreationContract, CreationGateResult, MissingConnection } from "./types";

export interface CreationRecord {
  work_id: string;
  capability_name: string;
  contract: CapabilityCreationContract;
  gate: CreationGateResult;
  recorded_at: string;
}

export function creationContractPath(
  root = process.env.WORK_SESSION_STATE_ROOT ?? resolve(process.cwd(), "local-runtime/work-session-state"),
): string {
  return resolve(root, "capability-creation.jsonl");
}

export function recordCreationContract(record: Omit<CreationRecord, "recorded_at">, path = creationContractPath()): CreationRecord {
  const row: CreationRecord = { ...record, recorded_at: new Date().toISOString() };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  return row;
}

export function readCreationContracts(path = creationContractPath()): CreationRecord[] {
  if (!existsSync(path)) return [];
  const out: CreationRecord[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as CreationRecord;
      if (typeof parsed?.capability_name === "string") out.push(parsed);
    } catch { /* a half-written final line is skipped, never repaired */ }
  }
  return out;
}

/** Current state per capability = its last record. */
export function currentCreationContract(capabilityName: string, path = creationContractPath()): CreationRecord | null {
  const rows = readCreationContracts(path).filter((r) => r.capability_name === capabilityName);
  return rows.length === 0 ? null : rows[rows.length - 1];
}

/** Every capability that is not OPERATIONAL, with exactly what it is missing. */
export function incompleteCapabilities(path = creationContractPath()): CreationRecord[] {
  const latest = new Map<string, CreationRecord>();
  for (const row of readCreationContracts(path)) latest.set(row.capability_name, row);
  return Array.from(latest.values()).filter((r) => r.gate.state !== "OPERATIONAL");
}

export interface ParkResult {
  work_id: string;
  parked: boolean;
  blocked_on: readonly string[];
  detail: string;
}

/**
 * ส่งงานที่ยังต่อไม่ครบไปนอนรออยู่ในคิวของ `control/work-continuation/`
 *
 * ไฟล์นี้ไม่ตัดสินใจว่าเมื่อไหร่ควรตื่น และไม่ได้เฝ้าดูอะไรเลย — มันแค่แปลง
 * "การเชื่อมต่อที่ขาด" เป็น dependency key แล้วบันทึกแถวรอ ตัวที่ตัดสินว่าตื่นได้
 * แล้วคือ `evaluate()` ของ capability นั้น ซึ่งเป็นตัวเดียวในระบบ
 *
 * `resume_condition` เป็น `ALL_AVAILABLE` เสมอโดยเจตนา: capability ที่ยังขาด
 * input อยู่ ไม่ได้พร้อมเพราะ output มาครบ — ทุกการเชื่อมต่อที่ขาดต้องมาครบจริง
 * ก่อนถึงจะกลับมาประเมินได้
 */
export function parkMissingConnections(
  workId: string,
  gate: CreationGateResult,
  options: { resolved_work_context_ref?: string | null; resolution_digest?: string | null; worker_class?: string | null } = {},
): ParkResult {
  const keys = gate.missing.map((m) => m.blocked_on).filter((k): k is string => typeof k === "string" && k.length > 0);
  if (keys.length === 0) {
    return { work_id: workId, parked: false, blocked_on: [], detail: "nothing is missing — there is nothing to wait for" };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wc = require("../work-continuation/contract") as typeof import("../work-continuation/contract");
    const byKind = (kinds: readonly MissingConnection["kind"][]): string[] =>
      gate.missing.filter((m) => kinds.includes(m.kind) && m.blocked_on).map((m) => m.blocked_on as string);

    wc.appendWaiting({
      work_id: workId,
      current_phase: gate.state,
      status: "WAITING",
      blocked_on: keys,
      required_evidence: byKind(["VERIFICATION"]),
      required_resources: byKind(["REGISTRATION"]),
      required_capabilities: byKind(["INPUT", "OUTPUT", "ROUTING", "CONTRACT_FIELD"]),
      required_runtime_state: byKind(["RUNTIME"]),
      required_external_state: [],
      resume_condition: "ALL_AVAILABLE",
      exact_state: null,
      next_action: gate.missing.map((m) => m.next_action).join(" · "),
      resolved_work_context_ref: options.resolved_work_context_ref ?? null,
      // The resolution digest AT BLOCK TIME. Without it a wake could dispatch
      // against a world that has since moved; the evaluator refuses that rather
      // than proceeding, which is the behaviour we want.
      last_verified_revision: options.resolution_digest ?? null,
      // SAFETY NET against the near-miss failure shape: the keys this row is
      // waiting on are recorded here as well, so a row that never wakes can be
      // diffed against the events that really arrived. Without it a key built
      // one character differently at the two ends is indistinguishable from
      // patience — nothing throws and nothing is logged.
      evidence_refs: keys,
      resume_attempt_count: 0,
      last_resume_reason: null,
      last_input_digest: null,
      last_result_digest: null,
      required_worker_class: options.worker_class ?? null,
      recorded_at: new Date().toISOString(),
    });
    return { work_id: workId, parked: true, blocked_on: keys, detail: `${keys.length} missing connection(s) parked for evidence-triggered resume` };
  } catch (error) {
    return { work_id: workId, parked: false, blocked_on: keys, detail: `could not park: ${error instanceof Error ? error.message : String(error)}` };
  }
}
