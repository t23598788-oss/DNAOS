import { buildSessionRegistry, type SessionRegistryEntry } from "./session-registry";
import { listWorkerRegistrations } from "./worker-registration";

export interface WorkerCapacityRequest { capability: string; required_count?: number; }
export interface AssignableWorker { agent_id: string; runtime_id: string | null; session_id: string; process_id: number | null; capabilities: readonly string[]; heartbeat: string; }
export interface WorkerCapacityResult { capability: string; available_workers: AssignableWorker[]; max_concurrency: number; evidence: string[]; resolved_at: string; }

/**
 * อ่านผลการตรวจหนึ่งข้อจาก `evidence[]` ที่ `worker-registration.ts#registerAndCheckReadiness`
 * เขียนไว้จริงในรูป `"<check>=true"` — ไม่ใช่ธงที่ใครก็ตั้งได้
 */
function recordedCheck(entry: Record<string, unknown>, check: string): boolean {
  const evidence = Array.isArray(entry.evidence) ? (entry.evidence as unknown[]) : [];
  return evidence.some((line) => String(line) === `${check}=true`);
}

/** ทุก ref ที่พิสูจน์ readiness ของแถวนี้ — จากที่ lifecycle เขียนจริง ไม่ใช่ที่ประกาศ */
function readinessEvidenceRefs(entry: Record<string, unknown>): string[] {
  const declared = Array.isArray(entry.readiness_evidence_refs) ? (entry.readiness_evidence_refs as unknown[]).map(String) : [];
  if (declared.length > 0) return declared;
  const evidence = Array.isArray(entry.evidence) ? (entry.evidence as unknown[]).map(String) : [];
  const probe = entry.last_probe_evidence_id ? [String(entry.last_probe_evidence_id)] : [];
  return [...evidence, ...probe];
}

/**
 * PRE-ASSIGNMENT readiness — ตรวจหลักฐานที่ lifecycle เดิมผลิตจริงเท่านั้น
 *
 * ── ทำไมต้องแก้ ────────────────────────────────────────────────────────────
 * เกณฑ์เดิมเรียกธง boolean หกตัว ซึ่งวัดแล้ว **ไม่มี producer ที่ไหนในระบบเขียนเลย**
 * ห้าตัว (identity_verified / workspace_verified / probe_verified /
 * readiness_verified_at / readiness_evidence_refs) ผลคือ hasStrictReadiness()
 * คืน true ไม่ได้สำหรับ worker ตัวใดเลย ไม่ใช่แค่ตอนนี้แต่โดยโครงสร้าง —
 * `resolveWorkerCapacity()` จึงคืน 0 เสมอ และ `createAssignment` ถูกเรียกไม่ได้
 *
 * ── หลักฐานเทียบเท่าที่มีจริง (พิสูจน์จาก source ไม่ใช่จากชื่อฟิลด์) ──────────
 * `worker-registration.ts#registerAndCheckReadiness` คำนวณ checks ชุดหนึ่ง แล้ว
 * เขียนผลลง `evidence[]` เป็น `"<check>=true"` และตั้ง `safe_to_assign = ready`
 * โดย `ready` เป็นจริงก็ต่อเมื่อ **ทุก** check ผ่าน รวม `harmless_probe` ด้วย:
 *
 *   identity_verified   ≡ checks.worker_identity
 *                         (worker_id && session_id && session_id !== "UNKNOWN")
 *   workspace_verified  ≡ checks.workspace_scope  (=== CANONICAL_ROOT)
 *   probe_verified      ≡ checks.harmless_probe -> evidence "probe_ok=true"
 *                         + last_probe_evidence_id ที่ probe จริงคืนมา
 *   readiness_evidence  ≡ evidence[] ทั้งชุด + probe_evidence_id
 *
 * ธง boolean ยังถูกยอมรับถ้ามีค่า เผื่อวันหน้ามี producer เขียนมันจริง — แต่ไม่ใช่
 * ทางเดียวอีกต่อไป และการอ่านจาก evidence[] เข้มกว่าเดิมด้วยซ้ำ เพราะสตริงนั้นถูก
 * เขียนโดยตัวตรวจเอง ไม่ใช่ค่าที่ผู้เรียกส่งเข้ามาได้
 *
 * ── สองข้อที่ย้ายออกเพราะผิด phase (ไม่ใช่ลดความปลอดภัย) ────────────────────
 * `assignment_evidence_verified` และ `transport_resumable` มีผู้เขียนแห่งเดียวคือ
 * `assignment-lifecycle.ts#completeAssignment` ซึ่งทำงาน **หลัง** งานเสร็จ การเอามา
 * เป็นเงื่อนไข "ก่อนได้รับงาน" คือ circular dependency: ต้องมี assignment ก่อนจึงจะ
 * ได้ evidence แต่ต้องมี evidence ก่อนจึงจะสร้าง assignment ได้ worker ตัวแรกจึง
 * ผ่านไม่ได้ตลอดกาล ทั้งสองยังคงถูกเขียนไว้เหมือนเดิมในฐานะ post-assignment
 * evidence ไม่มีอะไรถูกลบ เพียงแต่ไม่ถูกถามในจังหวะที่มันยังเกิดไม่ได้
 *
 * ── ข้อที่ไม่มีหลักฐานเทียบเท่า และรายงานไว้ตรง ๆ ──────────────────────────
 * `readiness_verified_at` ไม่มี producer ใดสร้าง timestamp นี้ ความหมายของมันคือ
 * "readiness เป็นของปัจจุบัน ไม่ใช่ของเก่า" ซึ่งบรรทัด heartbeat ≤ 60 วินาที
 * ด้านล่างบังคับอยู่แล้วและเข้มกว่า เพราะ heartbeat ต้องสดจริงตอนถาม ไม่ใช่
 * timestamp ที่ค้างอยู่ในแถว
 */
export function hasStrictReadiness(entry: (SessionRegistryEntry | ReturnType<typeof listWorkerRegistrations>[number]) & Record<string, unknown>): boolean {
  const stamp = new Date(String(entry.heartbeat ?? entry.heartbeat_at)).getTime();
  const heartbeatFresh = Number.isFinite(stamp) && Date.now() - stamp <= 60_000;
  return entry.status === "IDLE" && entry.safe_to_assign === true && entry.current_task_id === null &&
    (entry.identity_verified === true || recordedCheck(entry, "worker_identity")) &&
    (entry.workspace_verified === true || recordedCheck(entry, "workspace_scope")) &&
    (entry.probe_verified === true || (recordedCheck(entry, "probe_ok") && Boolean(entry.last_probe_evidence_id))) &&
    readinessEvidenceRefs(entry).length > 0 &&
    heartbeatFresh;
}

/** Capability matching is explicit: exact capability or the registered wildcard. No role/provider inference. */
export function selectAssignableWorkers(entries: readonly SessionRegistryEntry[], capability: string): AssignableWorker[] {
  return entries.filter((entry) => entry.status === "IDLE" && entry.safe_to_assign && entry.capabilities.some((candidate) => candidate === capability || candidate === "*"))
    .map((entry) => ({ agent_id: entry.agent_id, runtime_id: entry.runtime_id, session_id: entry.session_id, process_id: entry.process_id, capabilities: entry.capabilities, heartbeat: entry.heartbeat }));
}

/** Live resolver: reads the canonical Session Registry on every call. It never creates, marks, or assumes a worker. */
export async function resolveWorkerCapacity(request: WorkerCapacityRequest): Promise<WorkerCapacityResult> {
  const entries = await buildSessionRegistry();
  const sessionWorkers = selectAssignableWorkers(entries, request.capability);
  const registeredWorkers = listWorkerRegistrations().filter((worker) => hasStrictReadiness(worker as typeof worker & Record<string, unknown>) && worker.capabilities.some((candidate) => candidate === request.capability || candidate === "*"))
    .map((worker) => ({ agent_id: worker.worker_id, runtime_id: worker.runtime_id, session_id: worker.session_id, process_id: null, capabilities: worker.capabilities, heartbeat: worker.heartbeat_at }));
  const byId = new Map([...sessionWorkers, ...registeredWorkers].map((worker) => [worker.agent_id, worker]));
  const available_workers = [...byId.values()];
  return {
    capability: request.capability,
    available_workers,
    max_concurrency: available_workers.length,
    resolved_at: new Date().toISOString(),
    evidence: [
      "source=connections/agent-registry/session-registry.ts + worker-registration.ts",
      `candidate_entries=${entries.length}`,
      `eligible_workers=${available_workers.length}`,
      "eligibility=status=IDLE && safe_to_assign=true && exact_capability_match",
    ],
  };
}
