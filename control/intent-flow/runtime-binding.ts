/**
 * หน้าที่: อ่านการรันจริงจากคลังหลักฐานที่มีอยู่ แล้วฉายลงบนขั้นของ flow
 *
 * ── ทำไมเป็น read-model ไม่ใช่คลังใหม่ ──
 * ระบบมีคลังหลักฐานอยู่แล้วห้าที่ (evidence, handoffs, operations, tasks,
 * envelopes) การเพิ่มที่หกไม่ได้ทำให้ความจริงชัดขึ้น มันแค่เพิ่มที่ที่ต้อง
 * ทำให้ตรงกัน ไฟล์นี้จึงไม่เขียนอะไรลงดิสก์เลย — ทุกอย่างคำนวณจากของที่มี
 *
 * ── การผูกขั้นกับหลักฐาน ──
 * ผูกจากช่อง `kind` และ `source` ที่ผู้ผลิตหลักฐาน "ประกาศเอง" ตอนบันทึก
 * ไม่ใช่จากชื่อไฟล์ ไม่ใช่จากความคล้ายของชื่อ ตารางผูกอยู่ใน `STEP_BINDING`
 * ให้อ่านและโต้แย้งได้ในที่เดียว
 *
 * ── ความหมายที่ไม่มีใครประกาศ ยังคงเป็น UNKNOWN ──
 * `readDeclaredSemantics` อ่านเฉพาะคีย์ที่ผู้ผลิตประกาศไว้ตรงตัวเท่านั้น
 * payload ที่ไม่มีคีย์เหล่านั้นให้ UNKNOWN ทุกช่อง ไม่มีเส้นทางใดในไฟล์นี้ที่
 * เดาความหมายจากชื่อคีย์ที่ใกล้เคียง จากโค้ดข้างเคียง หรือจากความน่าจะเป็น
 *
 * Input: run identity (task_id) หรือชุด observation ที่ป้อนตรง
 * Output: `bindRunObservations`, `RuntimeStepObservation`, `STEP_BINDING`
 * Dependency ที่อนุญาต: agent-gateway (อ่าน), owner-error-lane (ผูกเจ้าของ)
 * สิ่งที่ห้ามแตะ: ห้ามเขียนไฟล์ ห้าม dispatch ห้ามเติมความหมายที่ไม่มีใครประกาศ
 */

import { loadEvidenceForTask, loadHandoffsForTask, loadAllTasks } from "../agent-gateway/contract";
import type { Evidence, HandoffRecord, Task } from "../agent-gateway/types";
import { resolveOwnershipForPath } from "../owner-error-lane/contract";
import { RECOVERY_FLOW } from "./recovery-flow";
import { implementationForStep } from "./implementation-map";
import { UNKNOWN } from "./semantics";
import type { SemanticValue } from "./semantics";

export type StepId = (typeof RECOVERY_FLOW)[number]["flow_step_id"];

/** ขั้น -> ชนิดหลักฐานที่ผู้ผลิตประกาศไว้เอง (ไม่ใช่การเดาจากชื่อไฟล์) */
export interface StepBinding {
  readonly step_id: string;
  readonly evidence_kinds: readonly Evidence["kind"][];
  readonly uses_handoff: boolean;
  readonly uses_task_record: boolean;
  readonly rationale: string;
}

export const STEP_BINDING: readonly StepBinding[] = [
  { step_id: "S1_OWNER_COMMAND", evidence_kinds: ["idempotency"], uses_handoff: false, uses_task_record: true,
    rationale: "คำสั่งที่รับเข้ามาปรากฏเป็น task record พร้อม idempotency ของซองคำสั่ง" },
  { step_id: "S2_ADMISSION", evidence_kinds: ["admission"], uses_handoff: false, uses_task_record: false,
    rationale: "ตัวรับเข้าบันทึก kind=admission เอง" },
  { step_id: "S3_DECISION", evidence_kinds: ["policy_decision", "capability_lookup"], uses_handoff: false, uses_task_record: false,
    rationale: "ประตูนโยบายบันทึกคำตัดสินของตัวเองเป็น kind=policy_decision" },
  { step_id: "S4_WORK_ORDER", evidence_kinds: ["workspace_lifecycle"], uses_handoff: false, uses_task_record: true,
    rationale: "ใบสั่งงานปรากฏเป็น work_order บน task record และการเตรียม workspace" },
  { step_id: "S5_DISPATCH", evidence_kinds: [], uses_handoff: true, uses_task_record: false,
    rationale: "การส่งต่อไปยังผู้ทำงานคือ handoff record" },
  { step_id: "S6_EXECUTION", evidence_kinds: ["execution_output", "build_execution"], uses_handoff: false, uses_task_record: false,
    rationale: "ผู้ทำงานบันทึกผลของตัวเองเป็น kind=execution_output" },
  { step_id: "S7_RESULT", evidence_kinds: ["continuation"], uses_handoff: true, uses_task_record: true,
    rationale: "ผลที่ส่งกลับคือสถานะ handoff และสถานะ task" },
  { step_id: "S8_EVIDENCE", evidence_kinds: ["verification", "post_commit_verification", "test_verification", "contract_verification"], uses_handoff: false, uses_task_record: false,
    rationale: "การยืนยันบันทึกตัวเองเป็น kind=verification ตระกูลเดียวกัน" },
  { step_id: "S9_NEXT_DECISION", evidence_kinds: ["owner_decision", "promotion_decision"], uses_handoff: true, uses_task_record: false,
    rationale: "คำตัดสินขั้นถัดไปบันทึกเป็น kind=owner_decision หรืออยู่ใน next_action ของ handoff" },
  { step_id: "S10_OWNER_PRESENTATION", evidence_kinds: ["recovery"], uses_handoff: false, uses_task_record: true,
    rationale: "สิ่งที่ Owner เห็นคือรายการใน console feed ซึ่งบันทึกเป็น kind=recovery" },
];

export interface RuntimeStepObservation {
  readonly step_id: string;
  readonly run_id: string;
  readonly work_id: string | null;
  readonly task_id: string | null;

  readonly input: SemanticValue;
  readonly expected_input_contract: string | null;
  readonly output: SemanticValue;
  readonly expected_output_contract: string | null;

  readonly transformation_id: string | null;

  readonly runtime_component: string | null;
  readonly capability_id: string | null;
  readonly resource_id: string | null;
  readonly repository_id: string | null;
  readonly repo_relative_path: string | null;

  readonly input_evidence_refs: readonly string[];
  readonly output_evidence_refs: readonly string[];
  readonly runtime_evidence_refs: readonly string[];

  /** ผ่าน/ไม่ผ่านทางเทคนิค — แยกจากคำถามว่าความจริงยังเหมือนเดิมไหม */
  readonly technical_status: "SUCCESS" | "FAILURE" | "NOT_OBSERVED";
  readonly observed: boolean;
}

const UNOBSERVED_VALUE: SemanticValue = {
  identity: null, type: null, value_reference: null,
  meaning: UNKNOWN, unit: UNKNOWN,
  contract_version: null, destination: null, state: null, authority: null,
};

/** คีย์ที่นับว่า "ผู้ผลิตประกาศความหมายไว้เอง" — นอกรายการนี้คือ UNKNOWN */
const DECLARED_KEYS = [
  "semantic_identity", "semantic_type", "semantic_value_reference",
  "semantic_meaning", "semantic_unit", "semantic_contract_version",
  "semantic_destination", "semantic_state", "semantic_authority",
] as const;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * อ่านความหมายเฉพาะที่ประกาศไว้ตรงตัว
 *
 * ช่องที่ไม่มีใครประกาศได้ UNKNOWN ไม่ใช่ค่าที่อนุมานเอา นี่คือจุดที่กฎ
 * "UNKNOWN คือ UNKNOWN" ถูกบังคับจริง ไม่ใช่แค่เขียนไว้ในเอกสาร
 */
export function readDeclaredSemantics(payload: unknown): SemanticValue {
  const p = (payload !== null && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const get = (k: (typeof DECLARED_KEYS)[number]): string | null => str(p[k]);
  return {
    identity: get("semantic_identity"),
    type: get("semantic_type"),
    value_reference: get("semantic_value_reference"),
    meaning: get("semantic_meaning") ?? UNKNOWN,
    unit: get("semantic_unit") ?? UNKNOWN,
    contract_version: get("semantic_contract_version"),
    destination: get("semantic_destination"),
    state: get("semantic_state"),
    authority: get("semantic_authority"),
  };
}

export interface RunSources {
  readonly evidence: readonly Evidence[];
  readonly handoffs: readonly HandoffRecord[];
  readonly task: Task | null;
}

/** อ่านแหล่งความจริงที่มีอยู่ — ไม่สร้างของใหม่ ไม่เขียนอะไร */
export function readRunSources(taskId: string): RunSources {
  return {
    evidence: loadEvidenceForTask(taskId),
    handoffs: loadHandoffsForTask(taskId),
    task: loadAllTasks().find((t) => t.task_id === taskId) ?? null,
  };
}

const pathMemo = new Map<string, ReturnType<typeof resolveOwnershipForPath>>();
function ownedPath(p: string): ReturnType<typeof resolveOwnershipForPath> {
  const hit = pathMemo.get(p);
  if (hit !== undefined) return hit;
  const r = resolveOwnershipForPath(p);
  pathMemo.set(p, r);
  return r;
}

function ownershipFor(paths: readonly string[]): {
  capability_id: string | null; resource_id: string | null;
  repository_id: string | null; repo_relative_path: string | null;
} {
  for (const p of paths) {
    const owned = ownedPath(p);
    if (owned.capability_id !== null || owned.resource_id !== null) {
      return { capability_id: owned.capability_id, resource_id: owned.resource_id,
        repository_id: owned.repository_id, repo_relative_path: owned.repo_relative_path };
    }
  }
  return { capability_id: null, resource_id: null, repository_id: null, repo_relative_path: null };
}

function failedStatus(rows: readonly Evidence[], handoffs: readonly HandoffRecord[]): boolean {
  const bad = handoffs.some((h) => h.status === "BLOCKED" || h.status === "FAILED");
  const evBad = rows.some((e) => {
    const p = (e.payload !== null && typeof e.payload === "object" ? e.payload : {}) as Record<string, unknown>;
    const s = str(p.status) ?? str(p.decision) ?? str(p.result);
    return s !== null && /^(FAIL|FAILED|DENY|DENIED|BLOCKED|ERROR|REJECTED)$/i.test(s);
  });
  return bad || evBad;
}

/**
 * ฉายการรันจริงลงบนขั้นทั้งสิบ
 *
 * ขั้นที่ไม่มีหลักฐานได้ `observed=false` และ `NOT_OBSERVED` — ไม่ใช่ SUCCESS
 * และไม่ใช่ FAILURE การไม่เห็นไม่ใช่การเห็นว่าดี
 */
export function bindRunObservations(taskId: string, sources?: RunSources): readonly RuntimeStepObservation[] {
  const src = sources ?? readRunSources(taskId);
  const workId = str((src.task?.route_context as Record<string, unknown> | undefined)?.work_id)
    ?? str((src.task as unknown as Record<string, unknown> | null)?.work_id);
  const runId = `run:${taskId}`;

  return RECOVERY_FLOW.map((step) => {
    const impl = step.implementation ?? implementationForStep(step.flow_step_id);
    const binding = STEP_BINDING.find((b) => b.step_id === step.flow_step_id);
    const kinds = binding?.evidence_kinds ?? [];
    const rows = src.evidence.filter((e) => kinds.includes(e.kind));
    const handoffs = binding?.uses_handoff === true ? src.handoffs : [];
    const taskRow = binding?.uses_task_record === true ? src.task : null;

    const observed = rows.length > 0 || handoffs.length > 0 || taskRow !== null;
    if (!observed) {
      return {
        step_id: step.flow_step_id, run_id: runId, work_id: workId, task_id: taskId,
        input: UNOBSERVED_VALUE, expected_input_contract: step.required_input,
        output: UNOBSERVED_VALUE, expected_output_contract: step.expected_output,
        transformation_id: null,
        runtime_component: impl?.repo_relative_path ?? null,
        capability_id: impl?.capability_id ?? null, resource_id: impl?.resource_id ?? null,
        repository_id: impl?.repository_id ?? null, repo_relative_path: impl?.repo_relative_path ?? null,
        input_evidence_refs: [], output_evidence_refs: [], runtime_evidence_refs: [],
        technical_status: "NOT_OBSERVED", observed: false,
      };
    }

    const first = rows[0];
    const last = rows[rows.length - 1];
    const paths = [
      ...handoffs.flatMap((h) => [...h.files_changed, ...h.files_read]),
      ...(impl?.repo_relative_path !== undefined ? [impl.repo_relative_path] : []),
    ];
    const own = ownershipFor(paths.filter((x): x is string => typeof x === "string"));
    const p = (last?.payload !== null && typeof last?.payload === "object" ? last.payload : {}) as Record<string, unknown>;

    return {
      step_id: step.flow_step_id, run_id: runId, work_id: workId, task_id: taskId,
      input: first !== undefined ? readDeclaredSemantics(first.payload) : UNOBSERVED_VALUE,
      expected_input_contract: step.required_input,
      output: last !== undefined ? readDeclaredSemantics(last.payload) : UNOBSERVED_VALUE,
      expected_output_contract: step.expected_output,
      transformation_id: str(p.transformation_id),
      runtime_component: str(last?.source) ?? impl?.repo_relative_path ?? null,
      capability_id: own.capability_id ?? impl?.capability_id ?? null,
      resource_id: own.resource_id ?? impl?.resource_id ?? null,
      repository_id: own.repository_id ?? impl?.repository_id ?? null,
      repo_relative_path: own.repo_relative_path ?? impl?.repo_relative_path ?? null,
      // เก็บตัวชี้ ไม่ใช่ payload — คลังนี้มีหมื่นแถว การคัดลอกทั้งก้อนไม่จำเป็น
      input_evidence_refs: first !== undefined ? [`evidence:${first.evidence_id}`] : [],
      output_evidence_refs: last !== undefined ? [`evidence:${last.evidence_id}`] : [],
      runtime_evidence_refs: [
        ...rows.map((e) => `evidence:${e.evidence_id}`),
        ...handoffs.map((h) => `handoff:${h.handoff_id}`),
        ...(taskRow !== null ? [`task:${taskRow.task_id}`] : []),
      ],
      technical_status: failedStatus(rows, handoffs) ? "FAILURE" : "SUCCESS",
      observed: true,
    };
  });
}
