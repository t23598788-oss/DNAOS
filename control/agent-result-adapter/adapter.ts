/**
 * หน้าที่: แปลง `DnaOsAgentResult` (สิ่งที่ Agent คืนมา) เป็น `WorkResultInput`
 * (สิ่งที่ Result Ingress รับ) โดยไม่สร้างความหมายใหม่แม้แต่ฟิลด์เดียว
 *
 * ทำไมต้องมีไฟล์นี้: สองสัญญานี้มีอยู่จริงทั้งคู่ แต่รูปไม่ตรงกัน และไม่เคยมีตัว
 * เชื่อม ที่ผ่านมาสายนี้จึงขาดตรงกลาง — ผลของ Agent ไม่เคยเดินทางไปถึงการลงทะเบียน
 *
 * กฎที่ไฟล์นี้ยึด และเป็นเหตุผลที่มันยาวกว่าที่คิด:
 *
 * 1. `artifacts[]` ของ Agent **ไม่ใช่** รายการไฟล์ที่ถูกแก้ มันคือสิ่งที่ Agent
 *    อ้างถึง — ไฟล์ที่มันแค่อ่านก็อยู่ในนั้น (พิสูจน์แล้วจากการรันจริง 40 รอบ:
 *    งาน READ ONLY คืน artifact ของไฟล์ที่ไม่ได้ถูกแตะเลย) การแปลง artifact เป็น
 *    files_changed ตรง ๆ จึงเป็นการรายงานว่ามีการแก้ไฟล์ทั้งที่ไม่มี
 *    ไฟล์จะเข้า files_changed ได้ก็ต่อเมื่อผู้เรียกส่ง "การเปลี่ยนแปลงที่วัดมาแล้ว"
 *    (path + hash ก่อน/หลัง) มาให้ ซึ่งเป็นหลักฐานอิสระจากคำพูดของ Agent
 *
 * 2. Agent บอกว่า PASS ไม่เท่ากับ VERIFIED — DNA OS เป็นผู้ตัดสินว่า verified
 *    ไม่ใช่ผู้ทำงาน PASS จึงกลายเป็น RECEIVED เสมอ
 *
 * 3. `requested_actions[]` คือสิ่งที่ Agent **ขอให้ทำ** ไม่ใช่สิ่งที่ทำแล้ว
 *    มันไม่ถูกแปลงเป็น files_changed หรือ next_action โดยอัตโนมัติ
 *
 * 4. `tests_run[]` มาจากหลักฐานการรันเทสต์จริงเท่านั้น `verification.checked_against`
 *    ของ DnaOsAgentResult เป็นการตรวจรูปแบบโปรโตคอล ไม่ใช่การรันเทสต์
 *
 * ทุกฟิลด์ที่แปลงมีบันทึกที่มา และทุกอย่างที่แปลงไม่ได้ถูกรายงานเป็น UNRESOLVED
 * ไม่ใช่ถูกทิ้งเงียบ
 *
 * Input: DnaOsAgentResult + หลักฐานที่วัดมาแล้วจากผู้เรียก
 * Output: adaptAgentResult -> { work_result, provenance, unresolved }
 * Dependency ที่อนุญาต: ../agent-gateway/contract (types เท่านั้น),
 *   ../work-result-ingress/contract (types เท่านั้น)
 * สิ่งที่ห้ามแตะ: ห้ามเดาชื่อไฟล์จากข้อความใด ๆ ห้ามแปลง artifact เป็น
 *   files_changed โดยไม่มีหลักฐานการเปลี่ยนแปลงที่วัดมา
 */
import type { DnaOsAgentResult } from "../agent-gateway/agent-execution-contract";
import type { WorkResultInput } from "../work-result-ingress/types";
import type { HandoffStatus } from "../agent-gateway/types";

/** การเปลี่ยนแปลงไฟล์ที่ "วัดมาแล้ว" — ผู้เรียกต้องพิสูจน์เอง ไม่ใช่ Agent อ้าง */
export interface VerifiedFileChange {
  /** path แบบอิงรากของ repo — ไม่ใช่ absolute path และไม่ใช่ URI */
  readonly repo_relative_path: string;
  readonly sha256_before: string | null;
  readonly sha256_after: string;
  /** ใครวัด — ชื่อผู้วัดจริง ไม่ใช่ "agent" */
  readonly measured_by: string;
}

/** เทสต์ที่รันจริง พร้อมผลจริง — ไม่ใช่เทสต์ที่ "ควรรัน" */
export interface ExecutedTest {
  readonly test_id: string;
  readonly outcome: "PASS" | "FAIL";
  readonly evidence_ref: string;
}

export interface AdaptContext {
  /** บทบาทของ worker จากบันทึกการ dispatch — ไม่ได้เดาจากผลลัพธ์ */
  readonly role: string;
  /** รากของ repo ใช้ตรวจว่า path ที่วัดมาอยู่ในขอบเขตจริง */
  readonly repo_root: string;
  /** path ที่ WorkOrder อนุญาตให้เขียน — ใช้ตรวจ ไม่ได้ใช้เดา */
  readonly allowed_write_paths: readonly string[];
  /**
   * ADDITIVE (Owner, RESOLVE_AGENT_HANDOFF_PRINCIPAL PHASE 3). principal ที่
   * เชื่อถือได้ ซึ่ง DNA OS เป็นผู้ resolve มาก่อนการรัน (ดู
   * `control/agent-gateway/handoff-principal.ts`)
   *
   * เมื่อมีค่านี้ มันจะ **ทับ** `DnaOsAgentResult.worker_id` ในการเติม
   * `agent_id` เสมอ — ผู้ทำงานไม่ใช่ผู้ประกาศว่าตัวเองเป็นใคร
   *
   * เมื่อไม่มีค่านี้ พฤติกรรมยังเหมือนเดิมทุกประการ (caller เดิม 20+ รายไม่กระทบ)
   * และค่าที่ได้จะเป็น `worker_id` ซึ่งเป็น WorkerKind ไม่ใช่ principal จึงถูก
   * `validateHandoff` ปฏิเสธด้วย AGENT_ID_NOT_ALLOWLISTED ตามที่ควรเป็น
   */
  readonly handoff_principal_id?: string;
  readonly verified_file_changes?: readonly VerifiedFileChange[];
  readonly executed_tests?: readonly ExecutedTest[];
  /** ไฟล์ที่พิสูจน์ได้ว่าถูกอ่านจริง — ไม่ใช่ไฟล์ที่ "อนุญาตให้อ่าน" */
  readonly verified_files_read?: readonly string[];
}

/**
 * `TRUSTED_CONTEXT` (additive) = ค่ามาจากสิ่งที่ DNA OS resolve เองก่อนการรัน
 * ไม่ใช่จากสิ่งที่ผลลัพธ์ของผู้ทำงานประกาศมา — ใช้กับฟิลด์ที่เป็นตัวตนซึ่ง
 * ผู้ทำงานต้องไม่มีสิทธิ์ประกาศเอง
 */
export type ProvenanceKind = "DIRECT_FIELD" | "DETERMINISTIC_MAP" | "MEASURED_EVIDENCE" | "EMPTY_NO_EVIDENCE" | "TRUSTED_CONTEXT";

export interface FieldProvenance {
  readonly field: string;
  readonly kind: ProvenanceKind;
  readonly source: string;
  readonly note?: string;
}

export interface UnresolvedItem {
  readonly kind: "UNRESOLVED_ARTIFACT" | "UNCONVERTED_REQUESTED_ACTION" | "UNMAPPED_FIELD";
  readonly original: string;
  readonly reason: string;
}

export interface AdaptOutcome {
  readonly work_result: WorkResultInput;
  readonly provenance: readonly FieldProvenance[];
  readonly unresolved: readonly UnresolvedItem[];
  /** ต้องเป็น 0 เสมอ — มีไว้ให้ตรวจ ไม่ใช่ให้เชื่อ */
  readonly guessed_field_count: number;
  readonly original_result_ref: string;
}

/**
 * Agent บอก PASS ไม่ได้แปลว่า VERIFIED
 *
 * VERIFIED เป็นคำตัดสินของ DNA OS หลังตรวจเอง งานที่ Agent บอกว่าสำเร็จจึงเข้าสู่
 * ระบบในสถานะ "รับมาแล้ว" เท่านั้น — การแมป PASS เป็น VERIFIED จะทำให้ผู้ทำงาน
 * เป็นผู้ตัดสินผลงานตัวเอง ซึ่งเป็นสิ่งที่ทั้งระบบนี้ออกแบบมาเพื่อไม่ให้เกิด
 */
const STATUS_MAP: Readonly<Record<DnaOsAgentResult["status"], HandoffStatus>> = {
  PASS: "RECEIVED",
  FAIL: "FAILED",
  ERROR: "FAILED",
  BLOCKED: "BLOCKED",
  FAIL_CLOSED: "BLOCKED",
};

/** ตัด scheme ของ artifact URI ออก คืน path ดิบ — ไม่ตีความอะไรต่อ */
function artifactPath(uri: string): string | null {
  const m = /^artifact:\/\/(.*)$/.exec(uri);
  if (!m) return null;
  const p = m[1];
  return p.startsWith("/") ? p : null;
}

const toRepoRelative = (abs: string, root: string): string | null => {
  const r = root.endsWith("/") ? root : `${root}/`;
  return abs.startsWith(r) ? abs.slice(r.length) : null;
};

export function adaptAgentResult(result: DnaOsAgentResult, ctx: AdaptContext): AdaptOutcome {
  const provenance: FieldProvenance[] = [];
  const unresolved: UnresolvedItem[] = [];

  const status = STATUS_MAP[result.status];
  provenance.push({ field: "status", kind: "DETERMINISTIC_MAP",
    source: `DnaOsAgentResult.status=${result.status}`,
    note: result.status === "PASS" ? "PASS -> RECEIVED: ผู้ทำงานไม่ใช่ผู้ตัดสินว่า VERIFIED" : undefined });

  provenance.push({ field: "task_id", kind: "DIRECT_FIELD", source: "DnaOsAgentResult.task_id" });
  const agent_id = ctx.handoff_principal_id ?? result.worker_id;
  provenance.push({ field: "agent_id",
    kind: ctx.handoff_principal_id ? "TRUSTED_CONTEXT" : "DIRECT_FIELD",
    source: ctx.handoff_principal_id ? "AdaptContext.handoff_principal_id (DNA OS resolve ก่อนรัน)" : "DnaOsAgentResult.worker_id",
    note: ctx.handoff_principal_id
      ? `ทับค่าที่ผลลัพธ์ประกาศมา (worker_id=${result.worker_id}) — ผู้ทำงานไม่ใช่ผู้ประกาศตัวตนของตัวเอง`
      : "ยังไม่มี principal ที่ resolve ได้ ค่านี้จึงเป็น WorkerKind ไม่ใช่ principal และจะถูก validateHandoff ปฏิเสธ" });
  provenance.push({ field: "input_reference", kind: "DIRECT_FIELD", source: "DnaOsAgentResult.work_order_id" });
  provenance.push({ field: "role", kind: "DIRECT_FIELD", source: "AdaptContext.role (จากบันทึก dispatch)" });
  provenance.push({ field: "evidence_refs", kind: "DIRECT_FIELD", source: "DnaOsAgentResult.evidence_refs" });

  // ----- files_changed: มาจากการวัดเท่านั้น -----
  const measured = ctx.verified_file_changes ?? [];
  const inScope = measured.filter((c) =>
    ctx.allowed_write_paths.some((p) => c.repo_relative_path === p || c.repo_relative_path.startsWith(`${p}/`)));
  for (const c of measured) {
    if (inScope.includes(c)) continue;
    unresolved.push({ kind: "UNMAPPED_FIELD", original: c.repo_relative_path,
      reason: "วัดว่าเปลี่ยนจริง แต่อยู่นอก allowed_write_paths — ไม่นับเป็นผลงานของงานนี้" });
  }
  const files_changed = inScope.map((c) => c.repo_relative_path).sort();
  provenance.push({ field: "files_changed",
    kind: files_changed.length ? "MEASURED_EVIDENCE" : "EMPTY_NO_EVIDENCE",
    source: files_changed.length
      ? `AdaptContext.verified_file_changes (วัดโดย ${inScope.map((c) => c.measured_by).filter((v, i, a) => a.indexOf(v) === i).join(",")})`
      : "ไม่มีการเปลี่ยนแปลงไฟล์ที่วัดมา" });

  // artifact ที่ไม่มีการวัดรองรับ = ยังไม่รู้ว่ามันคืออะไร ไม่ใช่ไฟล์ที่ถูกแก้
  const changedSet = new Set(files_changed);
  for (const a of result.artifacts) {
    const abs = artifactPath(a);
    const rel = abs ? toRepoRelative(abs, ctx.repo_root) : null;
    if (rel && changedSet.has(rel)) continue;
    unresolved.push({ kind: "UNRESOLVED_ARTIFACT", original: a,
      reason: rel
        ? "artifact ชี้ไปที่ไฟล์จริง แต่ไม่มีหลักฐานว่าไฟล์นั้นเปลี่ยน"
        : "artifact ไม่ได้ชี้ไปที่ path ในรากของ repo นี้" });
  }

  // ----- tests_run: จากการรันจริงเท่านั้น -----
  const executed = ctx.executed_tests ?? [];
  const tests_run = executed.map((t) => t.test_id).sort();
  provenance.push({ field: "tests_run",
    kind: tests_run.length ? "MEASURED_EVIDENCE" : "EMPTY_NO_EVIDENCE",
    source: tests_run.length ? "AdaptContext.executed_tests"
      : "ไม่มีหลักฐานการรันเทสต์ — verification.checked_against เป็นการตรวจโปรโตคอล ไม่ใช่เทสต์" });

  // ----- blockers: เก็บของเดิมไว้ทั้งดุ้น ไม่ตีความใหม่ -----
  const blockers = [
    ...result.errors.map((e) =>
      `${e.error_code}|severity=${e.severity}|retryable=${e.retryable}|required_capability=${e.required_capability ?? "NONE"}`),
    ...(result.status === "BLOCKED" || result.status === "FAIL_CLOSED"
      ? [`AGENT_STATUS_${result.status}|error_code=${result.error_code ?? "NONE"}`] : []),
  ];
  provenance.push({ field: "blockers", kind: "DIRECT_FIELD",
    source: "DnaOsAgentResult.errors[] + status", note: "เก็บ error_code/severity/retryable เดิมไว้ ไม่ตีความใหม่" });

  // requested_actions คือคำขอ ไม่ใช่สิ่งที่ทำแล้ว — ไม่แปลงเป็นอะไรทั้งนั้น
  for (const a of result.requested_actions) {
    unresolved.push({ kind: "UNCONVERTED_REQUESTED_ACTION",
      original: `${a.operation} ${a.target} (${a.artifact_ref})`,
      reason: "เป็นสิ่งที่ Agent ขอให้ทำ ไม่ใช่สิ่งที่ทำแล้ว — ต้องผ่านเส้นทางอนุมัติของระบบเอง" });
  }
  provenance.push({ field: "next_action", kind: "EMPTY_NO_EVIDENCE",
    source: "ไม่แปลงจาก requested_actions — ระบบเป็นผู้ตัดสินขั้นถัดไป" });

  const files_read = [...(ctx.verified_files_read ?? [])].sort();
  provenance.push({ field: "files_read",
    kind: files_read.length ? "MEASURED_EVIDENCE" : "EMPTY_NO_EVIDENCE",
    source: files_read.length ? "AdaptContext.verified_files_read" : "ไม่มีหลักฐานว่าอ่านไฟล์ไหน" });

  const work_result: WorkResultInput = {
    task_id: result.task_id,
    agent_id,
    role: ctx.role,
    input_reference: result.work_order_id,
    files_read,
    files_changed,
    tests_run,
    status,
    evidence_refs: result.evidence_refs,
    blockers,
    next_action: null,
  };

  return { work_result, provenance, unresolved, guessed_field_count: 0,
           original_result_ref: result.result_id };
}
