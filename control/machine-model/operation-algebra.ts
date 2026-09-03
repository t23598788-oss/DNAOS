/**
 * หน้าที่: ภาษาการดำเนินการของ DNA OS — แปลงผลลัพธ์ที่ Owner ต้องการ เป็นการ
 *         ประกอบตัวดำเนินการที่ระบบมีอยู่จริง โดยไม่ต้องมีโมเดลภาษามาช่วยคิด
 *
 * ── ตัวแก้สมการต้องเป็นตัวเดียว ──
 * ถ้าแต่ละผลลัพธ์ต้องเขียนโค้ดเฉพาะของมันเอง (`if outcome === "OPEN_APPLICATION"`)
 * สิ่งที่ได้ไม่ใช่ภาษา แต่เป็นรายการสูตรสำเร็จที่ต้องเพิ่มทีละอันตลอดไป ไฟล์นี้จึงมี
 * ตัวแก้ตัวเดียวที่ทำงานบนชนิด ตัวดำเนินการ สัญญา ความสัมพันธ์ ทรัพยากร และอำนาจ
 * — สมการทดสอบเป็น "ข้อมูล" ไม่ใช่สาขาของโค้ด
 *
 * ── ตัวดำเนินการต้องมีอยู่จริง ไม่ใช่มีเพราะน่าจะมี ──
 * `OBSERVE` `READ` `WRITE` `MOVE` ไม่ถูกสร้างขึ้นเพราะมันมีประโยชน์ ตัวดำเนินการ
 * เกิดได้เมื่อมีโทเคนที่ระบบประกาศไว้เอง ผูกกับความสามารถที่มีตัวตนในทะเบียน
 * ชนิดที่ไม่มีคำประกาศ คือไม่มี — และสมการที่ต้องใช้มันจะแทนไม่ได้
 *
 * ── อ่าน ไม่เท่ากับ เขียน ──
 * พฤติกรรมของตัวดำเนินการถูกจำแนกจากหลักฐานที่ประกาศไว้ ไม่ใช่จากชื่อ ตัวที่แปลง
 * ข้อความได้ ไม่ได้รับอำนาจเปลี่ยนสถานะของระบบเพียงเพราะมันผลิตข้อความออกมาได้
 *
 * Input: ทะเบียนที่มีอยู่ + composition model
 * Output: `classifyCapabilityLevels`, `canonicalOperators`, `resolveOutcomeExpression`
 * Dependency ที่อนุญาต: ./composition.ts, ./invocation.ts, ./self-tool.ts (อ่าน)
 * สิ่งที่ห้ามแตะ: ห้ามสร้างตัวดำเนินการที่ไม่มีคำประกาศ ห้ามซ่อมสัญญา ห้ามรันสมการ
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listCapabilities } from "../command-router/contract";
import { EXECUTOR_BINDINGS } from "../owner-backbone/route-dispatch";
import { projectDeclaredInvocations } from "./invocation";
import { buildSelfToolModel } from "./self-tool";
import { capabilityContracts, contractCompatibility, machineActionPrimitives } from "./composition";
import type { CapabilityContract, ActionClass } from "./composition";
import { aiResourceModel } from "./execution-authority";
import type { MachineModel } from "./model";
import type { DependencyIndex } from "./dependency-index";

const RELATIONSHIPS = "software/registry-database/data/canonical/relationships.jsonl";

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

// ─────────────────────── PHASE 1 — สี่ระดับ ───────────────────────

export type CapabilityLevel =
  | "PRIMITIVE_OPERATION" | "COMPOSITE_CAPABILITY" | "CONTROL_ORCHESTRATION"
  | "IMPLEMENTATION_INFRASTRUCTURE" | "UNCLASSIFIED";

export interface LevelAssignment {
  readonly capability_id: string;
  readonly level: CapabilityLevel;
  readonly basis: string;
  readonly evidence: readonly string[];
}

/** ลำดับการตัดสิน ประกาศไว้ให้โต้แย้งได้ — ไม่ใช่ผลข้างเคียงของโค้ด */
export const LEVEL_ORDER: readonly CapabilityLevel[] = [
  "CONTROL_ORCHESTRATION", "COMPOSITE_CAPABILITY",
  "PRIMITIVE_OPERATION", "IMPLEMENTATION_INFRASTRUCTURE", "UNCLASSIFIED",
];

/**
 * จำแนกความสามารถเป็นสี่ระดับจากหลักฐานเชิงโครงสร้าง
 *
 * ไม่มีการดูชื่อ: ผู้ควบคุมคือตัวที่ปรากฏเป็น "ผู้เรียก" ในคำประกาศการเรียกใช้
 * ตัวประกอบคือตัวที่มีเส้น ORCHESTRATES_CAPABILITY ออกไปหาตัวอื่น ตัวดำเนินการ
 * พื้นฐานคือตัวที่มีโทเคนการกระทำและสัญญา ส่วนที่เหลือที่มีแต่โมดูลรองรับ คือ
 * โครงสร้างพื้นฐาน
 */
export function classifyCapabilityLevels(
  contracts: readonly CapabilityContract[],
  model: MachineModel,
  index: DependencyIndex,
): readonly LevelAssignment[] {
  const declared = projectDeclaredInvocations();
  const callers = new Set(declared.map((d) => d.caller).filter((c): c is string => c !== null));
  const orchestrators = new Set(readJsonl(RELATIONSHIPS)
    .filter((r) => r.relationship_kind === "ORCHESTRATES_CAPABILITY")
    .map((r) => String(r.from_id)));
  const primitives = machineActionPrimitives(model, index);
  const actionCaps = new Map<string, ActionClass[]>();
  for (const p of primitives) {
    for (const c of p.capability_ids) {
      actionCaps.set(c, [...(actionCaps.get(c) ?? []), p.action_class]);
    }
  }

  return contracts.map((c) => {
    const id = c.capability_id;
    if (callers.has(id)) {
      return { capability_id: id, level: "CONTROL_ORCHESTRATION" as const,
        basis: "ปรากฏเป็นผู้เรียกในคำประกาศการเรียกใช้",
        evidence: declared.filter((d) => d.caller === id).map((d) => d.evidence_ref).slice(0, 2) };
    }
    if (orchestrators.has(id)) {
      return { capability_id: id, level: "COMPOSITE_CAPABILITY" as const,
        basis: "มีเส้น ORCHESTRATES_CAPABILITY ออกไปหาความสามารถอื่น",
        evidence: [`relationships:ORCHESTRATES_CAPABILITY:from=${id}`] };
    }
    const actions = actionCaps.get(id) ?? [];
    if (actions.length > 0 && (c.input_contract.length > 0 || c.output_contract.length > 0)) {
      return { capability_id: id, level: "PRIMITIVE_OPERATION" as const,
        basis: `มีโทเคนการกระทำที่ประกาศไว้ (${actions.join(",")}) และมีสัญญา`,
        evidence: c.evidence.slice(0, 2) };
    }
    if (c.implemented_by.length > 0 && actions.length === 0 && c.execution_boundary.length === 0) {
      return { capability_id: id, level: "IMPLEMENTATION_INFRASTRUCTURE" as const,
        basis: "มีโมดูลรองรับ แต่ไม่มีโทเคนการกระทำและไม่มีทางเข้าที่ประกาศไว้",
        evidence: c.implemented_by.slice(0, 2) };
    }
    return { capability_id: id, level: "UNCLASSIFIED" as const,
      basis: "หลักฐานเชิงโครงสร้างไม่พอจะจัดระดับ",
      evidence: c.evidence.slice(0, 1) };
  });
}

// ─────────────────────── PHASE 2 — ชนิดของตัวถูกดำเนินการ ───────────────────────

export interface OperandType {
  readonly type_id: string;
  readonly source_authority: string;
  readonly used_as_input_by: readonly string[];
  readonly produced_by: readonly string[];
  readonly evidence: readonly string[];
}

/**
 * ชนิดข้อมูลที่ระบบประกาศไว้จริงในสัญญา
 *
 * ไม่ได้สร้าง ENTITY/STATE/DATA ขึ้นมาเพราะโจทย์เอ่ยถึง — คืนเฉพาะชื่อชนิดที่
 * ปรากฏใน `input_contract`/`output_contract` ของทะเบียนเท่านั้น
 */
export function canonicalOperandTypes(contracts: readonly CapabilityContract[]): readonly OperandType[] {
  const acc = new Map<string, { inputs: Set<string>; outputs: Set<string> }>();
  for (const c of contracts) {
    for (const t of c.input_contract) {
      const cur = acc.get(t) ?? { inputs: new Set<string>(), outputs: new Set<string>() };
      cur.inputs.add(c.capability_id);
      acc.set(t, cur);
    }
    for (const t of c.output_contract) {
      const cur = acc.get(t) ?? { inputs: new Set<string>(), outputs: new Set<string>() };
      cur.outputs.add(c.capability_id);
      acc.set(t, cur);
    }
  }
  return [...acc.entries()]
    .map(([type_id, v]) => ({
      type_id,
      source_authority: "software/registry-database/data/canonical/capabilities.jsonl",
      used_as_input_by: [...v.inputs],
      produced_by: [...v.outputs],
      evidence: [`capabilities#input_contract/output_contract=${type_id}`],
    }))
    .sort((a, b) => (b.used_as_input_by.length + b.produced_by.length) - (a.used_as_input_by.length + a.produced_by.length));
}

// ─────────────────────── PHASE 3/5 — ตัวดำเนินการ ───────────────────────

export type OperatorBehavior =
  | "OBSERVATION" | "TRANSFORMATION" | "STATE_CHANGE" | "CONTROL" | "VERIFICATION" | "UNDETERMINED";

export interface CanonicalOperator {
  readonly operator_id: string;
  readonly action_class: ActionClass;
  readonly capability_id: string;
  readonly input_type: readonly string[];
  readonly output_type: readonly string[];
  readonly side_effect: readonly string[];
  readonly authority_requirement: string | null;
  readonly resource_requirement: readonly string[];
  readonly verification_requirement: readonly string[];
  readonly behavior: OperatorBehavior;
  /**
   * คำประกาศสองแหล่งขัดกัน — เช่นเป้าหมายการสังเกตประกาศอำนาจ `OBSERVE_ONLY`
   * ขณะที่ความสามารถเดียวกันประกาศ `side_effects` ไว้ ทั้งสองเป็นคำประกาศจริง
   * ทั้งคู่ จึงไม่เลือกให้เงียบ ๆ แต่รายงานว่าขัดกัน
   */
  readonly declaration_conflict: boolean;
  readonly contract_complete: boolean;
  readonly missing_fields: readonly string[];
  readonly evidence: readonly string[];
}

/**
 * ตัวดำเนินการที่พิสูจน์ได้ว่ามีอยู่จริง
 *
 * เกิดจากคู่ (โทเคนการกระทำที่ประกาศไว้ x ความสามารถที่เป็นเจ้าของ) เท่านั้น
 * ช่องที่ไม่มีใครประกาศจะถูกเก็บไว้เป็นช่องว่าง ไม่ถูกเติมให้เต็ม
 */
export function canonicalOperators(
  contracts: readonly CapabilityContract[],
  model: MachineModel,
  index: DependencyIndex,
): readonly CanonicalOperator[] {
  const primitives = machineActionPrimitives(model, index);
  const levels = new Map(classifyCapabilityLevels(contracts, model, index).map((l) => [l.capability_id, l.level]));
  const routerRows = listCapabilities() as unknown as readonly Record<string, any>[];
  const byId = new Map(contracts.map((c) => [c.capability_id, c]));
  const observeAuthority = new Set(primitives
    .filter((p) => p.declared_tokens.some((t) => t.toUpperCase().includes("OBSERVE_ONLY")))
    .flatMap((p) => p.capability_ids));

  const out: CanonicalOperator[] = [];
  for (const p of primitives) {
    if (p.status === "MISSING") continue;
    for (const capId of p.capability_ids) {
      const c = byId.get(capId);
      if (c === undefined) continue;
      const missing: string[] = [];
      if (c.input_contract.length === 0) missing.push("INPUT_TYPE");
      if (c.output_contract.length === 0) missing.push("OUTPUT_TYPE");
      if (c.verification_contract.length === 0) missing.push("VERIFICATION_REQUIREMENT");

      const routerRow = routerRows.find((r) => r.capability_id === c.canonical_name);
      const binding = (EXECUTOR_BINDINGS as unknown as readonly Record<string, any>[])
        .find((b) => b.capability_canonical_name === c.canonical_name);
      const authority = routerRow !== undefined ? `permission_requirement=${routerRow.permission_requirement}`
        : binding !== undefined ? `execution_enabled=${binding.execution_enabled}`
        : null;
      if (authority === null) missing.push("AUTHORITY_REQUIREMENT");

      // ── พฤติกรรม ตัดสินจากหลักฐาน ไม่ใช่จากชื่อการกระทำ ──
      // ผลข้างเคียงที่ประกาศไว้ เป็นหลักฐานที่หนักที่สุดว่าตัวนี้เปลี่ยนสถานะโลกจริง
      // หนักกว่าอำนาจที่ประกาศไว้กับเป้าหมายการสังเกต ซึ่งพูดถึงคนละเรื่อง
      const conflict = observeAuthority.has(capId) && c.side_effect.length > 0;
      const behavior: OperatorBehavior =
        levels.get(capId) === "CONTROL_ORCHESTRATION" ? "CONTROL"
        : c.side_effect.length > 0 ? "STATE_CHANGE"
        : observeAuthority.has(capId) ? "OBSERVATION"
        : c.verification_contract.length > 0 && c.output_contract.length > 0
          && c.input_contract.length > 0 ? "TRANSFORMATION"
        : "UNDETERMINED";

      out.push({
        operator_id: `${p.action_class}@${capId}`,
        action_class: p.action_class, capability_id: capId,
        input_type: c.input_contract, output_type: c.output_contract,
        side_effect: c.side_effect, authority_requirement: authority,
        resource_requirement: c.required_resource_contract,
        verification_requirement: c.verification_contract,
        behavior, declaration_conflict: conflict,
        contract_complete: missing.length === 0, missing_fields: missing,
        evidence: [...p.evidence.slice(0, 2), ...c.evidence.slice(0, 1)],
      });
    }
  }
  return out;
}

// ─────────────────────── PHASE 4 — นิพจน์ ───────────────────────

export interface OperatorPair {
  readonly inner: string;
  readonly outer: string;
  readonly shared_type: readonly string[];
  readonly evidence: readonly string[];
}

/** คู่ตัวดำเนินการที่ซ้อนกันได้จริง: OUTER(INNER(x)) */
export function composableOperatorPairs(
  operators: readonly CanonicalOperator[],
  contracts: readonly CapabilityContract[],
): readonly OperatorPair[] {
  const byId = new Map(contracts.map((c) => [c.capability_id, c]));
  const pairs: OperatorPair[] = [];
  for (const inner of operators) {
    for (const outer of operators) {
      if (inner.operator_id === outer.operator_id) continue;
      const a = byId.get(inner.capability_id), b = byId.get(outer.capability_id);
      if (a === undefined || b === undefined) continue;
      const edge = contractCompatibility(a, b);
      if (edge.compatibility !== "COMPATIBLE") continue;
      pairs.push({ inner: inner.operator_id, outer: outer.operator_id,
        shared_type: edge.shared_contract, evidence: edge.evidence });
    }
  }
  return pairs;
}

// ─────────────────────── PHASE 6 — สมการของ Owner ───────────────────────

export interface OwnerOutcomeExpression {
  readonly outcome_id: string;
  readonly target: string;
  readonly desired_state_or_result: string;
  readonly constraints: readonly string[];
  readonly required_operations: readonly ActionClass[];
  readonly dependencies: readonly string[];
  readonly verification_requirement: readonly ActionClass[];
}

/**
 * สมการทดสอบ — เป็น "ข้อมูล" ไม่ใช่สาขาของโค้ด
 *
 * ตัวแก้สมการตัวเดียวรับโครงสร้างนี้ได้ทุกใบ การเพิ่มผลลัพธ์ใหม่จึงเป็นการเพิ่ม
 * ข้อมูล ไม่ใช่การเพิ่ม `if` ในตัวแก้ และไม่มี path ของซอร์สอยู่ในความหมายของมัน
 */
export const OWNER_TEST_EXPRESSIONS: readonly OwnerOutcomeExpression[] = [
  { outcome_id: "OPEN_APPLICATION", target: "application", desired_state_or_result: "application_open",
    constraints: ["allowlisted_target"], required_operations: ["OPEN"],
    dependencies: [], verification_requirement: ["OBSERVE"] },
  { outcome_id: "READ_VISIBLE_INFORMATION", target: "visible_surface", desired_state_or_result: "information_returned",
    constraints: [], required_operations: ["OBSERVE", "READ"],
    dependencies: [], verification_requirement: [] },
  { outcome_id: "MOVE_FILE", target: "local_file", desired_state_or_result: "file_at_destination",
    constraints: ["destination_declared"], required_operations: ["MOVE"],
    dependencies: [], verification_requirement: ["VERIFY"] },
  { outcome_id: "MODIFY_BEHAVIOR", target: "software_behavior", desired_state_or_result: "behavior_matches_target",
    constraints: ["write_gate_decision"], required_operations: ["WRITE"],
    dependencies: [], verification_requirement: ["VERIFY"] },
  { outcome_id: "VERIFY_RESULT", target: "previous_change", desired_state_or_result: "result_matches_expected",
    constraints: [], required_operations: ["VERIFY"],
    dependencies: [], verification_requirement: ["VERIFY"] },
];

// ─────────────────────── PHASE 7/9/10 — ตัวแก้สมการตัวเดียว ───────────────────────

export interface OperationResolution {
  readonly operation: ActionClass;
  readonly capability_id: string | null;
  readonly implementation: readonly string[];
  readonly resource: readonly string[];
  readonly status: "PROVEN" | "DECLARED_NOT_EXECUTABLE" | "MISSING";
}

export interface EquationResult {
  readonly outcome_id: string;
  readonly expression_representable: boolean;
  readonly operations_required: readonly ActionClass[];
  readonly operations_proven: readonly ActionClass[];
  readonly operations_missing: readonly ActionClass[];
  readonly resolutions: readonly OperationResolution[];
  readonly contract_gaps: readonly string[];
  readonly resource_gaps: readonly string[];
  readonly authority_gaps: readonly string[];
  readonly verification_gaps: readonly string[];
  readonly evidence: readonly string[];
}

/**
 * ตัวแก้สมการตัวเดียวสำหรับทุกผลลัพธ์
 *
 * ทำงานบนชนิด ตัวดำเนินการ สัญญา ทรัพยากร และอำนาจ — ไม่มีสาขาใดที่ถามว่า
 * `outcome_id` คืออะไร การเพิ่มผลลัพธ์ใหม่ไม่ต้องแตะฟังก์ชันนี้เลย
 */
export function resolveOutcomeExpression(
  expression: OwnerOutcomeExpression,
  operators: readonly CanonicalOperator[],
  model: MachineModel,
  index: DependencyIndex,
): EquationResult {
  const tools = buildSelfToolModel(model, index);
  const contracts = capabilityContracts(model, index);
  const byAction = new Map<ActionClass, CanonicalOperator[]>();
  for (const op of operators) {
    byAction.set(op.action_class, [...(byAction.get(op.action_class) ?? []), op]);
  }

  const resolutions: OperationResolution[] = [];
  const contractGaps: string[] = [];
  const resourceGaps: string[] = [];
  const authorityGaps: string[] = [];
  const evidence: string[] = [];

  const allOperations = [...new Set([...expression.required_operations, ...expression.verification_requirement])];
  for (const operation of allOperations) {
    const candidates = byAction.get(operation) ?? [];
    if (candidates.length === 0) {
      resolutions.push({ operation, capability_id: null, implementation: [], resource: [], status: "MISSING" });
      continue;
    }
    const chosen = candidates.find((c) =>
      tools.find((t) => t.capability_id === c.capability_id)?.executable_now === true) ?? candidates[0];
    const contract = contracts.find((c) => c.capability_id === chosen.capability_id);
    const executable = tools.find((t) => t.capability_id === chosen.capability_id)?.executable_now === true;
    resolutions.push({
      operation, capability_id: chosen.capability_id,
      implementation: contract?.implemented_by ?? [],
      resource: chosen.resource_requirement,
      status: executable ? "PROVEN" : "DECLARED_NOT_EXECUTABLE",
    });
    for (const m of chosen.missing_fields) {
      if (m === "AUTHORITY_REQUIREMENT") authorityGaps.push(`${operation}:${chosen.capability_id}`);
      else contractGaps.push(`${operation}:${chosen.capability_id}:${m}`);
    }
    if (chosen.resource_requirement.length === 0) resourceGaps.push(`${operation}:${chosen.capability_id}`);
    evidence.push(...chosen.evidence.slice(0, 1));
  }

  const proven = resolutions.filter((r) => r.status === "PROVEN").map((r) => r.operation);
  const missing = resolutions.filter((r) => r.status === "MISSING").map((r) => r.operation);
  const verificationGaps = expression.verification_requirement
    .filter((v) => !proven.includes(v))
    .map((v) => `VERIFICATION_NOT_PROVEN:${v}`);

  return {
    outcome_id: expression.outcome_id,
    // แทนสมการได้ = ทุกการดำเนินการที่ต้องใช้ มีตัวดำเนินการที่ประกาศไว้รองรับ
    expression_representable: missing.length === 0,
    operations_required: expression.required_operations,
    operations_proven: proven, operations_missing: missing,
    resolutions, contract_gaps: contractGaps, resource_gaps: resourceGaps,
    authority_gaps: authorityGaps, verification_gaps: verificationGaps,
    evidence: [...new Set(evidence)],
  };
}

// ─────────────────────── PHASE 8 — ตำแหน่งของ AI ───────────────────────

export interface AiOperationPosition {
  readonly position_id: string;
  readonly input_contract: readonly string[];
  readonly output_contract: readonly string[];
  readonly visible_data_scope: string | null;
  readonly work_scope: readonly string[];
  readonly verification_requirement: readonly string[];
  readonly evidence: readonly string[];
}

/**
 * ตำแหน่งที่ต้องใช้การแปลงเชิงความน่าจะเป็น/ภาษา
 *
 * มีได้ก็ต่อเมื่อมีตัวดำเนินการที่ประกาศว่าต้องการทรัพยากรชนิดนั้น ไม่ใช่เพราะ
 * ระบบมีทรัพยากร AI อยู่ ถ้าไม่มีคำประกาศ ผลคือศูนย์ — และไม่มีการประดิษฐ์ขึ้น
 */
export function aiOperationPositions(operators: readonly CanonicalOperator[]): readonly AiOperationPosition[] {
  const ai = aiResourceModel();
  const positions: AiOperationPosition[] = [];
  for (const op of operators) {
    const match = ai.filter((a) => a.work_scope.includes(op.action_class));
    if (match.length === 0) continue;
    positions.push({
      position_id: `ai-position:${op.operator_id}`,
      input_contract: op.input_type, output_contract: op.output_type,
      visible_data_scope: match[0].visible_data_scope,
      work_scope: match[0].work_scope,
      verification_requirement: op.verification_requirement,
      evidence: [...op.evidence, ...match[0].evidence],
    });
  }
  return positions;
}
