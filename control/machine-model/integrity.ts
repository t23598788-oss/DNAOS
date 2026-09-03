/**
 * หน้าที่: ปิดข้อบกพร่องที่หนักที่สุด — ระบบเคยลงมือทำสิ่งที่อธิบายตัวเองไม่ได้
 *
 * ── ทำไมข้อนี้มาก่อนช่องว่างอีก 861 ใบ ──
 * ความสามารถที่ไม่เคยถูกเรียกแล้วยังไม่มีเอกสาร เป็นหนี้ที่ยังไม่ถึงกำหนด แต่
 * ความสามารถที่ "รันไปแล้ว 13,338 ครั้ง" โดยที่ระบบตอบไม่ได้ว่ามันรับอะไร คืนอะไร
 * ใครอนุญาต และผลไปไหน คือระบบที่ลงมือทำสิ่งที่ตัวเองไม่เข้าใจอยู่ทุกวัน
 *
 * ── เห็นว่ารัน ไม่ได้แปลว่ารู้ว่าทำไม ──
 * หลักฐานการรันพิสูจน์ว่า "มีบางอย่างเกิดขึ้น" เท่านั้น มันไม่พิสูจน์ว่าสิ่งนั้น
 * มีไว้ทำไม แปลว่าอะไร หรือใครมีอำนาจสั่ง ไฟล์นี้จึงไม่แปลงการสังเกตเป็นความหมาย
 * ไม่ว่าจะเห็นมากี่ครั้งก็ตาม
 *
 * ── ผู้เรียกไม่ใช่ผู้มีอำนาจ ──
 * เส้นการเรียกทางเทคนิคไม่สร้างอำนาจย้อนขึ้นไป สายอำนาจมีทางเดียว:
 * Owner -> DNA OS -> คำตัดสิน -> การเลือกความสามารถ -> การอนุญาต -> ทรัพยากร
 * เหตุการณ์จากภายนอกเป็นตัวกระตุ้น ไม่ใช่ผู้สั่ง และในไฟล์นี้ไม่มีชนิดข้อมูลใด
 * ชื่อ AGENT_INTENT, SERVICE_INTENT หรือ PROCESS_INTENT ให้ใช้เลย
 *
 * Input: `MachineModel` + `DependencyIndex`
 * Output: `freezeIntegrityGaps`, `retrospectiveIntegrityGate`, `answerIntegrityQuestions`
 * Dependency ที่อนุญาต: ./self-knowledge.ts, ./invocation.ts, agent-gateway/owner-command (อ่าน)
 * สิ่งที่ห้ามแตะ: ห้ามสร้างข้อเท็จจริงเชิงความหมาย ห้ามเปิดประตูตรวจ ห้ามเขียน
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectObservedInvocations, invocationOfCapability } from "./invocation";
import { buildSelfKnowledge } from "./self-knowledge";
import type { CapabilityKnowledge } from "./self-knowledge";
import { buildSelfToolModel } from "./self-tool";
import type { MachineModel } from "./model";
import type { DependencyIndex } from "./dependency-index";

const TASKS = "control/agent-gateway/data/tasks.jsonl";
const EVIDENCE = "control/agent-gateway/data/evidence.jsonl";
const ENVELOPES = "control/owner-command/data/envelopes.jsonl";

function readJsonl(rel: string): readonly Record<string, any>[] {
  const path = join(process.cwd(), rel);
  if (!existsSync(path)) return [];
  const out: Record<string, any>[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (s.length === 0) continue;
    try { out.push(JSON.parse(s)); } catch { /* แถวเสียไม่ทำให้ทั้งชุดหาย */ }
  }
  return out;
}

/** ที่มาของการลงมือ — สองอย่างนี้ต้องไม่ปนกัน */
export type IntentOrigin = "OWNER_INTENT" | "DNA_OS_INTERNAL_DECISION" | "TEST_ORIGIN" | "NOT_TRACEABLE";

export type IntegrityField =
  | "IDENTITY" | "PURPOSE" | "OWNER_INTENT_RELATION" | "DNA_OS_DECISION_BOUNDARY"
  | "INPUT_CONTRACT" | "OUTPUT_CONTRACT" | "EXECUTION_BOUNDARY" | "EXECUTOR"
  | "REQUIRED_RESOURCES" | "RESULT_BOUNDARY" | "EVIDENCE" | "AUTHORITY" | "VERIFICATION_BOUNDARY";

export const INTEGRITY_FIELDS: readonly IntegrityField[] = [
  "IDENTITY", "PURPOSE", "OWNER_INTENT_RELATION", "DNA_OS_DECISION_BOUNDARY",
  "INPUT_CONTRACT", "OUTPUT_CONTRACT", "EXECUTION_BOUNDARY", "EXECUTOR",
  "REQUIRED_RESOURCES", "RESULT_BOUNDARY", "EVIDENCE", "AUTHORITY", "VERIFICATION_BOUNDARY",
];

export type GapDefect = "EXISTS_NOT_PROJECTED" | "DECLARED_NOT_BOUND" | "OBSERVED_UNDECLARED" | "NEVER_RECORDED";

export interface IntegrityFieldState {
  readonly field: IntegrityField;
  readonly status: "KNOWN" | "MISSING";
  readonly value: readonly string[];
  readonly canonical_authority: string | null;
  readonly evidence: readonly string[];
  readonly defect: GapDefect | null;
}

export interface IntegrityRecord {
  readonly capability_id: string;
  readonly canonical_name: string;
  readonly observed_execution_count: number;
  readonly last_observed_at: string;
  readonly intent_origins: readonly IntentOrigin[];
  readonly fields: readonly IntegrityFieldState[];
  readonly execution_observed: true;
  readonly knowledge_complete: boolean;
  readonly authority_traceable: boolean;
  readonly result_traceable: boolean;
  readonly verification_traceable: boolean;
  readonly classification: "HEALTHY_EXECUTION_MODEL" | "SELF_KNOWLEDGE_INTEGRITY_GAP";
  readonly outcome: "RESOLVED" | "PARTIAL" | "STILL_GAP";
}

/** ชนิดหลักฐานที่ผู้ผลิตประกาศเองว่าเป็นการยืนยันผล */
const VERIFICATION_KINDS = new Set([
  "verification", "post_commit_verification", "post_commit_check",
  "test_verification", "contract_verification", "security_verification", "candidate_verification",
]);

interface ExecutionContext {
  readonly task_ids: readonly string[];
  readonly origins: readonly IntentOrigin[];
  readonly output_lanes: readonly string[];
  readonly verification_kinds: readonly string[];
  readonly submitted_by: readonly string[];
}

/**
 * เดินจากหลักฐานการรันจริง ไปตามตัวชี้ที่แถวนั้นบรรจุไว้เท่านั้น
 *
 * `evidence.task_id` -> `tasks.jsonl` -> `submitted_by_client` / `output_lane`
 * และ `envelopes.jsonl` ซึ่งผูก task กับซองคำสั่งของ Owner ทุกก้าวเป็นการอ่าน
 * ตัวชี้ที่มีอยู่ ไม่มีการอนุมานจากรูปร่างของ payload หรือชื่อไฟล์
 */
function executionContextOf(capabilityId: string, componentPaths: ReadonlySet<string>): ExecutionContext {
  const evidenceRows = readJsonl(EVIDENCE).filter((e) => {
    const src = typeof e.source === "string" ? e.source.split("#")[0].split(" ")[0] : null;
    return src !== null && componentPaths.has(src);
  });
  const taskIds = [...new Set(evidenceRows.map((e) => String(e.task_id)).filter((t) => t.length > 0))];
  const taskById = new Map(readJsonl(TASKS).map((t) => [String(t.task_id), t]));
  const ownerTaskIds = new Set(readJsonl(ENVELOPES).map((e) => String(e.task_id)));

  const origins = new Set<IntentOrigin>();
  const lanes = new Set<string>();
  const submitted = new Set<string>();
  for (const id of taskIds) {
    const task = taskById.get(id);
    if (task === undefined) continue;
    const client = typeof task.submitted_by_client === "string" ? task.submitted_by_client : "";
    submitted.add(client);
    if (typeof task.output_lane === "string") lanes.add(task.output_lane);
    // ── ที่มาของอำนาจ อ่านจากคำประกาศ ไม่ใช่จากผู้เรียกทางเทคนิค ──
    if (ownerTaskIds.has(id)) origins.add("OWNER_INTENT");
    else if (client.startsWith("control/")) origins.add("DNA_OS_INTERNAL_DECISION");
    else if (/test|e2e|fixture/i.test(client)) origins.add("TEST_ORIGIN");
    else origins.add("NOT_TRACEABLE");
  }

  const verificationKinds = [...new Set(
    readJsonl(EVIDENCE)
      .filter((e) => taskIds.includes(String(e.task_id)) && VERIFICATION_KINDS.has(String(e.kind)))
      .map((e) => String(e.kind)))];

  // หลักฐานที่ task_id ชี้ไปยังแถวที่ไม่มีอยู่ ยังเป็นการรันที่เกิดขึ้นจริง
  // แต่สายอำนาจของมันขาด — ต้องพูดออกมาว่า "สืบไม่ได้" ไม่ใช่เว้นว่างไว้
  if (origins.size === 0) origins.add("NOT_TRACEABLE");
  return { task_ids: taskIds, origins: [...origins], output_lanes: [...lanes],
    verification_kinds: verificationKinds, submitted_by: [...submitted] };
}

let frozen: readonly IntegrityRecord[] | null = null;

/** ตรึงรายการที่รันไปแล้วแต่อธิบายตัวเองไม่ได้ แล้วไล่ปิดทีละช่อง */
export function freezeIntegrityGaps(model: MachineModel, index: DependencyIndex): readonly IntegrityRecord[] {
  if (frozen !== null) return frozen;
  const knowledge = buildSelfKnowledge(model, index);
  const tools = buildSelfToolModel(model, index);
  const observed = projectObservedInvocations();
  const targets = knowledge.filter((k) => k.integrity_gap);

  const out: IntegrityRecord[] = [];
  for (const k of targets) {
    const obs = observed.filter((o) => o.capability_id === k.capability_id);
    const componentPaths = new Set(obs.map((o) => o.executing_component));
    const ctx = executionContextOf(k.capability_id, componentPaths);
    const chain = invocationOfCapability(k.capability_id);
    const tool = tools.find((t) => t.capability_id === k.capability_id)!;
    const known = (f: string): CapabilityKnowledge["fields"][number] | undefined =>
      k.fields.find((x) => x.field === f);

    const F = (field: IntegrityField, value: readonly string[], authority: string | null,
               evidence: readonly string[]): IntegrityFieldState => {
      if (value.length > 0) {
        return { field, status: "KNOWN", value, canonical_authority: authority, evidence, defect: null };
      }
      // เห็นว่ารันแล้วแต่ไม่มีคำประกาศ คือข้อบกพร่องคนละชนิดกับไม่เคยมีใครบันทึก
      const defect: GapDefect = chain.status === "OBSERVED_UNDECLARED" ? "OBSERVED_UNDECLARED" : "NEVER_RECORDED";
      return { field, status: "MISSING", value: [], canonical_authority: authority, evidence, defect };
    };

    const fields: IntegrityFieldState[] = [
      F("IDENTITY", [k.capability_id, k.canonical_name], "registry-database:capabilities",
        [`registry-database:capabilities:${k.capability_id}`]),
      F("PURPOSE", known("PURPOSE")?.value ?? [], "capabilities.purpose",
        [`registry-database:capabilities:${k.capability_id}`]),
      F("OWNER_INTENT_RELATION", ctx.origins.includes("OWNER_INTENT") ? ["OWNER_INTENT"] : [],
        "control/owner-command/data/envelopes.jsonl", ctx.task_ids.slice(0, 2).map((t) => `envelope->task:${t}`)),
      F("DNA_OS_DECISION_BOUNDARY", ctx.origins.includes("DNA_OS_INTERNAL_DECISION")
        ? ctx.submitted_by.filter((s) => s.startsWith("control/")) : [],
        "tasks.submitted_by_client", ctx.task_ids.slice(0, 2).map((t) => `task:${t}`)),
      F("INPUT_CONTRACT", tool.input_contract, "capabilities.input_contract",
        [`registry-database:capabilities:${k.capability_id}`]),
      F("OUTPUT_CONTRACT", tool.output_contract, "capabilities.output_contract",
        [`registry-database:capabilities:${k.capability_id}`]),
      F("EXECUTION_BOUNDARY", chain.entry_boundary, "command-router:endpoint / owner-backbone:target_symbol",
        chain.declared_evidence),
      F("EXECUTOR", [...componentPaths], "agent-gateway:evidence.source",
        obs.map((o) => o.evidence_ref)),
      F("REQUIRED_RESOURCES", tool.required_resources, "registry-database:resource_capabilities",
        [`resource_capabilities:${k.capability_id}`]),
      F("RESULT_BOUNDARY", ctx.output_lanes, "tasks.output_lane",
        ctx.task_ids.slice(0, 2).map((t) => `task:${t}`)),
      F("EVIDENCE", obs.map((o) => o.evidence_ref), "agent-gateway:evidence", obs.map((o) => o.evidence_ref)),
      F("AUTHORITY", Object.entries({
          OWNER_CAN_REQUEST: k.authority.OWNER_CAN_REQUEST,
          DNA_OS_CAN_DECIDE: k.authority.DNA_OS_CAN_DECIDE,
          DNA_OS_CAN_EXECUTE: k.authority.DNA_OS_CAN_EXECUTE,
        }).filter(([, v]) => v).map(([n]) => n),
        "command-router / owner-backbone", k.authority.evidence),
      F("VERIFICATION_BOUNDARY", ctx.verification_kinds, "agent-gateway:evidence.kind",
        ctx.task_ids.slice(0, 2).map((t) => `task:${t}`)),
    ];

    const byField = new Map(fields.map((f) => [f.field, f]));
    const isKnown = (f: IntegrityField): boolean => byField.get(f)?.status === "KNOWN";
    // อำนาจสืบย้อนได้ = รู้ว่าการลงมือครั้งนั้นมาจากคำขอของ Owner หรือคำตัดสินของ DNA OS
    const authorityTraceable = (isKnown("OWNER_INTENT_RELATION") || isKnown("DNA_OS_DECISION_BOUNDARY"))
      && isKnown("AUTHORITY");
    const resultTraceable = isKnown("RESULT_BOUNDARY") && isKnown("EVIDENCE");
    const verificationTraceable = isKnown("VERIFICATION_BOUNDARY");
    const complete = fields.every((f) => f.status === "KNOWN");

    const healthy = complete && authorityTraceable && resultTraceable && verificationTraceable;
    const knownCount = fields.filter((f) => f.status === "KNOWN").length;

    out.push({
      capability_id: k.capability_id, canonical_name: k.canonical_name,
      observed_execution_count: obs.reduce((n, o) => n + o.occurrence_count, 0),
      last_observed_at: obs.map((o) => o.last_observed_at).sort().slice(-1)[0] ?? "",
      intent_origins: ctx.origins, fields,
      execution_observed: true, knowledge_complete: complete,
      authority_traceable: authorityTraceable, result_traceable: resultTraceable,
      verification_traceable: verificationTraceable,
      classification: healthy ? "HEALTHY_EXECUTION_MODEL" : "SELF_KNOWLEDGE_INTEGRITY_GAP",
      outcome: healthy ? "RESOLVED" : knownCount > fields.length / 2 ? "PARTIAL" : "STILL_GAP",
    });
  }
  frozen = out.sort((a, b) => b.observed_execution_count - a.observed_execution_count);
  return frozen;
}

// ─────────────────── PHASE 6 — ประตูตรวจย้อนหลัง (ยังไม่เปิด) ───────────────────

export type GateBlockReason =
  | "NO_CAPABILITY_IDENTITY" | "NO_EXECUTION_BOUNDARY" | "NO_INPUT_CONTRACT"
  | "NO_OUTPUT_CONTRACT" | "NO_AUTHORIZATION_PATH" | "NO_EXECUTOR_BOUNDARY" | "NO_EVIDENCE_REQUIREMENT";

export interface GateResult {
  readonly would_pass: number;
  readonly would_block: number;
  readonly block_reason_counts: Readonly<Record<string, number>>;
  readonly evaluated_capabilities: number;
  /** ประตูนี้ยังไม่ทำงานจริง — ตรึงไว้ด้วยชนิดข้อมูล */
  readonly enabled: false;
}

/**
 * ทดสอบย้อนหลังว่า ถ้าเคยมีกฎ "ห้ามรันถ้าไม่รู้จักตัวเอง" การรันในอดีตจะผ่านกี่ครั้ง
 *
 * เป็นการวิเคราะห์ล้วน ๆ ไม่มีการบล็อกอะไรจริง `enabled: false` เป็นชนิดข้อมูล
 * ตายตัว ผู้เรียกจึงเปิดมันด้วยความบังเอิญไม่ได้
 */
export function retrospectiveIntegrityGate(model: MachineModel, index: DependencyIndex): GateResult {
  const knowledge = buildSelfKnowledge(model, index);
  const tools = buildSelfToolModel(model, index);
  const observed = projectObservedInvocations();
  const counts: Record<string, number> = {};
  let pass = 0, block = 0;

  for (const o of observed) {
    const k = knowledge.find((x) => x.capability_id === o.capability_id);
    const tool = tools.find((x) => x.capability_id === o.capability_id);
    const chain = invocationOfCapability(o.capability_id);
    const reasons: GateBlockReason[] = [];
    if (k === undefined) reasons.push("NO_CAPABILITY_IDENTITY");
    if (chain.entry_boundary.length === 0) reasons.push("NO_EXECUTION_BOUNDARY");
    if ((tool?.input_contract.length ?? 0) === 0) reasons.push("NO_INPUT_CONTRACT");
    if ((tool?.output_contract.length ?? 0) === 0) reasons.push("NO_OUTPUT_CONTRACT");
    if (k !== undefined && !(k.authority.DNA_OS_CAN_DECIDE || k.authority.OWNER_CAN_REQUEST)) {
      reasons.push("NO_AUTHORIZATION_PATH");
    }
    if (chain.executor.length === 0) reasons.push("NO_EXECUTOR_BOUNDARY");
    if (chain.observed_evidence.length === 0 && chain.declared_evidence.length === 0) {
      reasons.push("NO_EVIDENCE_REQUIREMENT");
    }

    // นับเป็นจำนวนการรันจริง ไม่ใช่จำนวนความสามารถ — ประตูทำงานต่อการรัน
    if (reasons.length === 0) pass += o.occurrence_count;
    else {
      block += o.occurrence_count;
      for (const r of new Set(reasons)) counts[r] = (counts[r] ?? 0) + o.occurrence_count;
    }
  }
  return { would_pass: pass, would_block: block, block_reason_counts: counts,
    evaluated_capabilities: observed.length, enabled: false };
}

// ─────────────────────── PHASE 7 — คำถามของ Owner ───────────────────────

export interface IntegrityAnswer {
  readonly question: string;
  readonly answered: boolean;
  readonly value: readonly string[];
  readonly canonical_authority: string | null;
  readonly evidence: readonly string[];
}

const QUESTION_FIELD: readonly [string, IntegrityField][] = [
  ["อันนี้คือความสามารถอะไร", "IDENTITY"],
  ["มันมีไว้ทำอะไร", "PURPOSE"],
  ["DNA OS เลือกใช้มันเมื่ออะไร", "DNA_OS_DECISION_BOUNDARY"],
  ["มันรับอะไร", "INPUT_CONTRACT"],
  ["มันส่งอะไรกลับ", "OUTPUT_CONTRACT"],
  ["DNA OS สั่งทรัพยากรอะไรให้ลงมือ", "EXECUTOR"],
  ["ผลกลับมาที่ไหน", "RESULT_BOUNDARY"],
  ["อะไรเป็นหลักฐาน", "EVIDENCE"],
  ["ใครตรวจว่าผลถูกต้อง", "VERIFICATION_BOUNDARY"],
  ["มันเกี่ยวกับผลลัพธ์ของ Owner อย่างไร", "OWNER_INTENT_RELATION"],
];

/** สิบคำถาม ตอบจากช่องในระเบียน ไม่มีคำอธิบายที่แต่งขึ้น */
export function answerIntegrityQuestions(record: IntegrityRecord): readonly IntegrityAnswer[] {
  return QUESTION_FIELD.map(([question, field]) => {
    const f = record.fields.find((x) => x.field === field)!;
    return { question, answered: f.status === "KNOWN", value: f.value,
      canonical_authority: f.canonical_authority, evidence: f.evidence.slice(0, 2) };
  });
}
