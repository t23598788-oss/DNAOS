/**
 * หน้าที่: ตอบว่า DNA OS "รู้จักของของตัวเอง" ครบแค่ไหน ทีละความสามารถ ทีละช่อง
 *
 * ── รู้ครบ ไม่เท่ากับ ใช้ได้ ──
 * ความสามารถที่ Owner สั่งปิดไว้ ยังเป็นความสามารถที่ระบบรู้จักครบได้ นั่นคือ
 * สุขภาพที่ดี ตรงกันข้าม ความสามารถที่ "เคยรันไปแล้ว" แต่ระบบอธิบายไม่ได้ว่ามัน
 * คืออะไร รับอะไร คืนอะไร นั่นคือระบบที่ลงมือทำสิ่งที่ตัวเองไม่เข้าใจ — รายงาน
 * เป็น `SELF_KNOWLEDGE_INTEGRITY_GAP` แยกต่างหาก
 *
 * ── ข้อบกพร่องสี่ชนิด ไม่ใช่ชนิดเดียว ──
 * ข้อเท็จจริงที่มีอยู่ในทะเบียนแต่ไม่เคยถูกฉาย ต่างจากข้อเท็จจริงที่ประกาศไว้ที่อื่น
 * แต่ไม่ได้ผูกกับความสามารถ ต่างจากสิ่งที่เห็นว่ารันแต่ไม่มีใครประกาศ และต่างจาก
 * สิ่งที่ไม่เคยมีใครบันทึกเลย ทั้งสี่แก้กันคนละวิธี การยุบเป็น "MODEL_GAP" ก้อนเดียว
 * ทำให้ไม่มีใครรู้ว่าต้องเริ่มตรงไหน
 *
 * ── ผู้ลงมือ ไม่ใช่ผู้มีอำนาจ ──
 * ตัวที่รันงานไม่ได้กลายเป็นผู้อนุญาตเพราะมันรันได้ อำนาจทั้งห้าระดับจึงแยกกัน
 * และมาจากความสัมพันธ์ที่ประกาศไว้เท่านั้น Owner อยู่เหนือ DNA OS เสมอ
 *
 * ── AI ไม่ใช่หน่วยความจำของระบบ ──
 * ไม่มีทางใดในไฟล์นี้เรียกโมเดล ไม่มีการค้นซอร์ส และไม่มีคำอธิบายที่แต่งขึ้น
 * ทุกคำตอบมาจากระเบียนที่ DNA OS เป็นเจ้าของ
 *
 * Input: `MachineModel` + `DependencyIndex`
 * Output: `buildSelfKnowledge`, `answerOwnerSelfQuestions`, `aiRemovalProof`
 * Dependency ที่อนุญาต: ./self-tool.ts, ./invocation.ts, ทะเบียนที่มีอยู่ (อ่าน)
 * สิ่งที่ห้ามแตะ: ห้ามสร้างข้อเท็จจริงที่ไม่มีในทะเบียน ห้ามเขียน ห้ามสั่งรัน
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listCapabilities } from "../command-router/contract";
import { EXECUTOR_BINDINGS } from "../owner-backbone/route-dispatch";
import { projectDeclaredInvocations, projectObservedInvocations, invocationOfCapability } from "./invocation";
import { buildSelfToolModel } from "./self-tool";
import type { BlockReason } from "./self-tool";
import type { MachineModel } from "./model";
import type { DependencyIndex } from "./dependency-index";

export type FieldStatus = "KNOWN" | "MISSING" | "NOT_APPLICABLE";

/** ข้อบกพร่องสี่ชนิด แก้กันคนละวิธี */
export type DefectClass =
  | "EXISTS_NOT_PROJECTED"      // มีในทะเบียนแล้ว แต่ read-model ไม่ได้อ่าน
  | "DECLARED_NOT_BOUND"        // ประกาศไว้ที่อื่น แต่ไม่ได้ผูกกับความสามารถนี้
  | "OBSERVED_NOT_DECLARED"     // เห็นว่ารันจริง แต่ไม่มีใครประกาศ
  | "NEVER_RECORDED";           // ไม่เคยมีใครบันทึกเลย

export type KnowledgeField =
  | "IDENTITY" | "PURPOSE" | "OWNER_ACTION" | "INPUT_CONTRACT" | "OUTPUT_CONTRACT"
  | "INVOCATION_BOUNDARY" | "CALLER" | "EXECUTOR" | "RUNTIME" | "PROCESS"
  | "REQUIRED_RESOURCES" | "AUTHORITY" | "AVAILABILITY" | "EXECUTABILITY" | "EVIDENCE";

export const KNOWLEDGE_FIELDS: readonly KnowledgeField[] = [
  "IDENTITY", "PURPOSE", "OWNER_ACTION", "INPUT_CONTRACT", "OUTPUT_CONTRACT",
  "INVOCATION_BOUNDARY", "CALLER", "EXECUTOR", "RUNTIME", "PROCESS",
  "REQUIRED_RESOURCES", "AUTHORITY", "AVAILABILITY", "EXECUTABILITY", "EVIDENCE",
];

export interface FieldKnowledge {
  readonly field: KnowledgeField;
  readonly status: FieldStatus;
  readonly value: readonly string[];
  readonly canonical_authority: string | null;
  readonly evidence: readonly string[];
  readonly defect_class: DefectClass | null;
  /** NOT_APPLICABLE ต้องมีเหตุผลเชิงโครงสร้าง ไม่ใช่ "ไม่รู้" */
  readonly not_applicable_reason: string | null;
}

/** อำนาจห้าระดับ แยกจากกัน — ผู้ลงมือไม่ใช่ผู้อนุญาต */
export interface AuthorityMatrix {
  readonly OWNER_CAN_REQUEST: boolean;
  readonly DNA_OS_CAN_DECIDE: boolean;
  readonly DNA_OS_CAN_EXECUTE: boolean;
  readonly AGENT_CAN_EXECUTE: boolean;
  readonly EXTERNAL_RESOURCE_CAN_EXECUTE: boolean;
  readonly evidence: readonly string[];
}

export interface CapabilityKnowledge {
  readonly capability_id: string;
  readonly canonical_name: string;
  readonly fields: readonly FieldKnowledge[];
  readonly knowledge_complete: boolean;
  readonly executable_now: boolean;
  readonly block_reasons: readonly BlockReason[];
  /** รันไปแล้วทั้งที่อธิบายตัวเองไม่ได้ */
  readonly integrity_gap: boolean;
  readonly authority: AuthorityMatrix;
}

const CANONICAL_CAPABILITIES = "software/registry-database/data/canonical/capabilities.jsonl";

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

/**
 * อำนาจของความสามารถหนึ่งตัว จากความสัมพันธ์ที่ประกาศไว้
 *
 * `AGENT_CAN_EXECUTE` เป็นเท็จตราบใดที่การส่งงานอัตโนมัติยังปิดอยู่ — อ่านจาก
 * `execution_enabled` ที่ประกาศไว้ ไม่ใช่ค่าคงที่ที่เขียนตายในไฟล์นี้
 */
function authorityMatrixOf(canonicalName: string, capabilityId: string): AuthorityMatrix {
  const evidence: string[] = [];
  let ownerCanRequest = false, dnaCanDecide = false, dnaCanExecute = false;
  let agentCanExecute = false, externalCanExecute = false;

  for (const r of listCapabilities() as unknown as readonly Record<string, any>[]) {
    const declared = projectDeclaredInvocations()
      .some((d) => d.capability_id === capabilityId && d.evidence_ref.includes(`:${r.capability_id}`));
    if (r.capability_id !== canonicalName && !declared) continue;
    // มีคำสั่งที่ Owner พิมพ์ได้ = Owner ขอได้
    if (Array.isArray(r.supported_commands) && r.supported_commands.length > 0) {
      ownerCanRequest = true;
      evidence.push(`command-router:supported_commands=${r.supported_commands.join(",")}`);
    }
    // มีการประกาศว่าต้องผ่านประตูสิทธิ์ = DNA OS เป็นผู้ตัดสิน
    if (typeof r.permission_requirement === "string") {
      dnaCanDecide = true;
      evidence.push(`command-router:permission_requirement=${r.permission_requirement}`);
    }
  }

  for (const b of EXECUTOR_BINDINGS as unknown as readonly Record<string, any>[]) {
    if (b.capability_canonical_name !== canonicalName) continue;
    evidence.push(`owner-backbone:EXECUTOR_BINDINGS:${b.route_action}:execution_enabled=${b.execution_enabled}`);
    dnaCanDecide = true;
    if (b.execution_enabled === true) dnaCanExecute = true;
    // เส้นทางที่ปลายทางเป็น Agent ถูกประกาศปิดไว้ — อ่านจากคำประกาศ ไม่ใช่สมมติ
    if (b.execution_enabled === false && String(b.execution_disabled_reason ?? "").includes("AGENT")) {
      agentCanExecute = false;
      evidence.push(`owner-backbone:execution_disabled_reason=${String(b.execution_disabled_reason).slice(0, 48)}`);
    }
  }

  for (const c of readJsonl("connections/connection-registry/data/connections.jsonl")) {
    if (c.executor_capability_id !== capabilityId) continue;
    externalCanExecute = true;
    evidence.push(`connection-registry:${c.connection_id}:executor_capability_id`);
  }

  return { OWNER_CAN_REQUEST: ownerCanRequest, DNA_OS_CAN_DECIDE: dnaCanDecide,
    DNA_OS_CAN_EXECUTE: dnaCanExecute, AGENT_CAN_EXECUTE: agentCanExecute,
    EXTERNAL_RESOURCE_CAN_EXECUTE: externalCanExecute, evidence };
}

let cache: readonly CapabilityKnowledge[] | null = null;

/** เมทริกซ์ความรู้ของตัวเอง ทีละความสามารถ ทีละช่อง */
export function buildSelfKnowledge(model: MachineModel, index: DependencyIndex): readonly CapabilityKnowledge[] {
  if (cache !== null) return cache;
  const canonical = readJsonl(CANONICAL_CAPABILITIES);
  const tools = buildSelfToolModel(model, index);
  const declared = projectDeclaredInvocations();
  const observed = projectObservedInvocations();
  const routerRows = listCapabilities() as unknown as readonly Record<string, any>[];
  const routerNames = new Set(routerRows.map((r) => String(r.capability_id)));
  const boundRouterCaps = new Set(declared.filter((d) => d.evidence_ref.startsWith("command-router:")).map((d) => d.capability_id));

  const out: CapabilityKnowledge[] = [];
  for (const cap of canonical) {
    const id = String(cap.capability_id);
    const name = String(cap.canonical_name ?? id);
    const tool = tools.find((t) => t.capability_id === id)!;
    const chain = invocationOfCapability(id);
    const myDeclared = declared.filter((d) => d.capability_id === id);
    const wasObserved = observed.some((o) => o.capability_id === id);

    // ── เหตุผลเชิงโครงสร้างของ NOT_APPLICABLE ──
    // ทางเข้าที่ประกาศไว้เป็น "สัญลักษณ์ในโมดูล" (`file.ts#symbol`) แปลว่าการเรียก
    // เกิดในโปรเซสของผู้เรียกโดยรูปแบบของคำประกาศเอง ไม่ใช่บริการที่ฟังพอร์ตของ
    // ตัวเอง ความสามารถแบบนี้จึงไม่มีรันไทม์และไม่มีบริการเป็นของตัวเองโดยโครงสร้าง
    // — ต่างจาก "ยังไม่มีใครบันทึก"
    const inProcessOnly = myDeclared.length > 0
      && myDeclared.every((d) => d.kind !== "CAPABILITY_RUNS_IN_PROCESS")
      && chain.entry_boundary.length > 0
      && chain.entry_boundary.every((e) => e.includes("#") || e.endsWith(".ts"));

    const F = (field: KnowledgeField, value: readonly string[], authority: string | null,
               evidence: readonly string[], naReason?: string): FieldKnowledge => {
      if (naReason !== undefined) {
        return { field, status: "NOT_APPLICABLE", value: [], canonical_authority: authority,
          evidence, defect_class: null, not_applicable_reason: naReason };
      }
      if (value.length > 0) {
        return { field, status: "KNOWN", value, canonical_authority: authority, evidence,
          defect_class: null, not_applicable_reason: null };
      }
      // ── จำแนกข้อบกพร่อง ──
      const defect: DefectClass =
        // ประกาศไว้ในตัวจัดเส้นทางด้วยชื่อของมันเอง แต่ยังไม่ผูกกับความสามารถนี้
        routerNames.has(name) && !boundRouterCaps.has(id) ? "DECLARED_NOT_BOUND"
        // เห็นว่ารันจริงแล้ว แต่ไม่มีคำประกาศ
        : wasObserved ? "OBSERVED_NOT_DECLARED"
        : "NEVER_RECORDED";
      return { field, status: "MISSING", value: [], canonical_authority: authority, evidence,
        defect_class: defect, not_applicable_reason: null };
    };

    const sideEffects = Array.isArray(cap.side_effects) ? cap.side_effects.map(String) : [];
    const fields: FieldKnowledge[] = [
      F("IDENTITY", [id, name], CANONICAL_CAPABILITIES, [`registry-database:capabilities:${id}`]),
      F("PURPOSE", typeof cap.purpose === "string" && cap.purpose.length > 0 ? [cap.purpose] : [],
        `${CANONICAL_CAPABILITIES}#purpose`, [`registry-database:capabilities:${id}`]),
      F("OWNER_ACTION", tool.owner_representation.owner_action === null ? [] : [tool.owner_representation.owner_action],
        "command-router:supported_commands / owner-backbone:route_action", chain.declared_evidence),
      F("INPUT_CONTRACT", tool.input_contract, `${CANONICAL_CAPABILITIES}#input_contract`,
        [`registry-database:capabilities:${id}`]),
      F("OUTPUT_CONTRACT", tool.output_contract, `${CANONICAL_CAPABILITIES}#output_contract`,
        [`registry-database:capabilities:${id}`]),
      F("INVOCATION_BOUNDARY", chain.entry_boundary, "command-router:endpoint / owner-backbone:target_symbol",
        chain.declared_evidence),
      F("CALLER", chain.caller, "command-router / owner-backbone", chain.declared_evidence),
      F("EXECUTOR", chain.executor, "command-router:endpoint.module / evidence.source",
        [...chain.declared_evidence, ...chain.observed_evidence]),
      F("RUNTIME", chain.runtime_resource, "machine-observation:runtime-targets", chain.declared_evidence,
        inProcessOnly ? "ขอบเขตที่ประกาศไว้เป็นการเรียกโมดูลในโปรเซสเดียวกัน จึงไม่มีรันไทม์ของตัวเอง" : undefined),
      F("PROCESS", chain.process_service, "runtime-control:SERVICES", chain.declared_evidence,
        inProcessOnly ? "เรียกในโปรเซสของผู้เรียก จึงไม่มีบริการของตัวเอง" : undefined),
      F("REQUIRED_RESOURCES", tool.required_resources, "registry-database:resource_capabilities",
        [`resource_capabilities:${id}`]),
      F("AUTHORITY", tool.dimensions.authorityAllowsNow || tool.block_reasons.includes("EXECUTION_DISABLED")
        || tool.block_reasons.includes("AUTHORITY_DENIED") ? ["DECLARED"] : [],
        "command-router:permission_requirement / owner-backbone:execution_enabled", chain.declared_evidence),
      F("AVAILABILITY", tool.dimensions.resourcesAvailableNow ? ["RESOURCES_AVAILABLE"] : [],
        "machine-model:graph", [`machine://CAPABILITIES/${id}`]),
      F("EXECUTABILITY", [tool.executable_now ? "EXECUTABLE_NOW" : "NOT_EXECUTABLE_NOW"],
        "machine-model:self-tool", tool.evidence_path.slice(0, 2)),
      F("EVIDENCE", [...chain.declared_evidence, ...chain.observed_evidence, ...sideEffects.slice(0, 1)],
        "รวมทุกทะเบียน", tool.evidence_path.slice(0, 3)),
    ];

    // รู้ครบ = ไม่มีช่องไหนขาด (ช่องที่ไม่เกี่ยวโดยโครงสร้าง ไม่นับว่าขาด)
    const complete = fields.every((f) => f.status !== "MISSING");
    out.push({
      capability_id: id, canonical_name: name, fields,
      knowledge_complete: complete,
      executable_now: tool.executable_now,
      block_reasons: tool.block_reasons,
      integrity_gap: wasObserved && !complete,
      authority: authorityMatrixOf(name, id),
    });
  }
  cache = out;
  return out;
}

// ─────────────────────── PHASE 5 — คำถามของ Owner ───────────────────────

export interface OwnerAnswer {
  readonly question: string;
  readonly answered: boolean;
  readonly value: readonly string[];
  readonly canonical_authority: string | null;
  readonly evidence: readonly string[];
}

/**
 * คำตอบสิบสามข้อ ประกอบจากระเบียนล้วน ๆ
 *
 * ชั้นนี้ไม่แต่งข้อเท็จจริงใหม่ การแปลเป็นภาษาคนเกิดที่ชั้นแสดงผล และต้องชี้กลับ
 * มาที่ `canonical_authority` กับ `evidence` ของแต่ละข้อได้เสมอ
 */
export function answerOwnerSelfQuestions(
  knowledge: readonly CapabilityKnowledge[],
  model: MachineModel,
  capabilityId: string,
): readonly OwnerAnswer[] {
  const k = knowledge.find((x) => x.capability_id === capabilityId) ?? null;
  const field = (f: KnowledgeField): FieldKnowledge | null => k?.fields.find((x) => x.field === f) ?? null;
  const ans = (question: string, f: KnowledgeField): OwnerAnswer => {
    const fk = field(f);
    if (fk === null) return { question, answered: false, value: [], canonical_authority: null, evidence: [] };
    // ── NOT_APPLICABLE คือคำตอบ ไม่ใช่การไม่รู้ ──
    // "มันไม่มีบริการเป็นของตัวเองเพราะเรียกในโปรเซสของผู้เรียก" ตอบคำถามของ Owner
    // ได้จริง และมีเหตุผลเชิงโครงสร้างกำกับ ต่างจาก "ยังไม่มีใครบันทึก"
    if (fk.status === "NOT_APPLICABLE") {
      return { question, answered: true, value: [`NOT_APPLICABLE: ${fk.not_applicable_reason}`],
        canonical_authority: fk.canonical_authority, evidence: fk.evidence };
    }
    return { question, answered: fk.status === "KNOWN",
      value: fk.value, canonical_authority: fk.canonical_authority, evidence: fk.evidence };
  };

  const machineNode = model.nodes.find((n) => n.layer_id === "MACHINE") ?? null;
  const tools = knowledge.filter((x) => x.fields.find((f) => f.field === "INVOCATION_BOUNDARY")?.status === "KNOWN");

  return [
    { question: "มึงคืออะไร", answered: machineNode !== null,
      value: machineNode === null ? [] : [machineNode.label],
      canonical_authority: "execution/installation-initialization", evidence: [machineNode?.source_ref ?? ""] },
    { question: "มึงมีความสามารถอะไร", answered: knowledge.length > 0,
      value: [`${knowledge.length} ความสามารถที่ลงทะเบียนแล้ว`],
      canonical_authority: CANONICAL_CAPABILITIES, evidence: [`registry-database:capabilities`] },
    { question: "มึงมีเครื่องมืออะไร", answered: tools.length > 0,
      value: tools.map((t) => t.canonical_name),
      canonical_authority: "command-router / owner-backbone / runtime-targets",
      evidence: tools.flatMap((t) => t.fields.find((f) => f.field === "INVOCATION_BOUNDARY")!.evidence).slice(0, 3) },
    ans("เครื่องมือนี้มีไว้ทำอะไร", "PURPOSE"),
    { question: "ใครสั่งมันได้", answered: k !== null && Object.values({
        o: k.authority.OWNER_CAN_REQUEST, d: k.authority.DNA_OS_CAN_DECIDE,
        e: k.authority.DNA_OS_CAN_EXECUTE, a: k.authority.AGENT_CAN_EXECUTE,
        x: k.authority.EXTERNAL_RESOURCE_CAN_EXECUTE }).some(Boolean),
      value: k === null ? [] : Object.entries({
        OWNER_CAN_REQUEST: k.authority.OWNER_CAN_REQUEST,
        DNA_OS_CAN_DECIDE: k.authority.DNA_OS_CAN_DECIDE,
        DNA_OS_CAN_EXECUTE: k.authority.DNA_OS_CAN_EXECUTE,
        AGENT_CAN_EXECUTE: k.authority.AGENT_CAN_EXECUTE,
        EXTERNAL_RESOURCE_CAN_EXECUTE: k.authority.EXTERNAL_RESOURCE_CAN_EXECUTE,
      }).filter(([, v]) => v).map(([n]) => n),
      canonical_authority: "command-router / owner-backbone / connection-registry",
      evidence: k?.authority.evidence ?? [] },
    ans("สั่งผ่านอะไร", "INVOCATION_BOUNDARY"),
    ans("มันรับอะไร", "INPUT_CONTRACT"),
    ans("มันส่งอะไร", "OUTPUT_CONTRACT"),
    ans("ใครลงมือ", "EXECUTOR"),
    ans("มันทำงานอยู่ที่ไหน", "PROCESS"),
    ans("มันพึ่งอะไร", "REQUIRED_RESOURCES"),
    ans("ตอนนี้ใช้ได้ไหม", "EXECUTABILITY"),
    { question: "ถ้าใช้ไม่ได้ เพราะอะไร", answered: k !== null,
      value: k?.block_reasons ?? [], canonical_authority: "machine-model:self-tool",
      evidence: k?.fields.find((f) => f.field === "EXECUTABILITY")?.evidence ?? [] },
  ];
}

// ─────────────────────── PHASE 7 — ระบบต้องตอบได้เองโดยไม่มี AI ───────────────────────

export interface AiRemovalProof {
  readonly query: string;
  readonly answered_without_ai: boolean;
  readonly canonical_authority: string;
}

/** โมดูลที่ห้ามปรากฏในสายพึ่งพาของความรู้ตัวเอง */
const FORBIDDEN_DEPENDENCIES = [
  "ai/", "providers/", "connections/ai-providers", "anthropic", "openai",
  "agent-host", "agent-gateway/agent-script",
];

/**
 * พิสูจน์ว่าความรู้ของตัวเองไม่ได้พึ่ง AI หรือ Agent
 *
 * ไม่ประกาศผลลัพธ์ไว้ล่วงหน้า — ตรวจสองอย่าง: ซอร์สของชั้นความรู้ต้องไม่นำเข้า
 * โมดูลฝั่ง AI/Agent และคำถามทุกข้อต้องตอบได้จริงจากระเบียน
 */
export function aiRemovalProof(
  knowledge: readonly CapabilityKnowledge[],
  model: MachineModel,
): { readonly proofs: readonly AiRemovalProof[]; readonly forbidden_imports: readonly string[] } {
  const forbidden: string[] = [];
  for (const f of ["self-knowledge.ts", "self-tool.ts", "invocation.ts", "necessity.ts",
                   "model.ts", "census.ts", "dependency-index.ts", "machine-binding.ts"]) {
    const path = join(process.cwd(), "control/machine-model", f);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trimStart().startsWith("import ")) continue;
      for (const bad of FORBIDDEN_DEPENDENCIES) {
        if (line.includes(bad)) forbidden.push(`${f}: ${line.trim()}`);
      }
    }
  }

  const machineNode = model.nodes.find((n) => n.layer_id === "MACHINE") ?? null;
  const layer = (id: string): number => model.nodes.filter((n) => n.layer_id === id).length;
  const proofs: AiRemovalProof[] = [
    { query: "identity", answered_without_ai: machineNode !== null, canonical_authority: "installation-initialization" },
    { query: "owner relationship", answered_without_ai: knowledge.some((k) => k.authority.OWNER_CAN_REQUEST),
      canonical_authority: "command-router:supported_commands" },
    { query: "machine/installation", answered_without_ai: model.machine_id !== null, canonical_authority: "installation-initialization" },
    { query: "hardware/OS", answered_without_ai: layer("HARDWARE_OS") > 0, canonical_authority: "machine-model:census" },
    { query: "known resources", answered_without_ai: layer("FILES_PACKAGES") > 0, canonical_authority: "registry-database:resources" },
    { query: "known capabilities", answered_without_ai: knowledge.length > 0, canonical_authority: "registry-database:capabilities" },
    { query: "known tools", answered_without_ai: knowledge.some((k) =>
        k.fields.find((f) => f.field === "INVOCATION_BOUNDARY")?.status === "KNOWN"),
      canonical_authority: "command-router / owner-backbone" },
    { query: "purpose", answered_without_ai: knowledge.some((k) =>
        k.fields.find((f) => f.field === "PURPOSE")?.status === "KNOWN"), canonical_authority: "capabilities.purpose" },
    { query: "contracts", answered_without_ai: knowledge.some((k) =>
        k.fields.find((f) => f.field === "INPUT_CONTRACT")?.status === "KNOWN"), canonical_authority: "capabilities.input_contract" },
    { query: "dependencies", answered_without_ai: model.edges.length > 0, canonical_authority: "registry-database:relationships" },
    { query: "authority", answered_without_ai: knowledge.some((k) => k.authority.evidence.length > 0),
      canonical_authority: "command-router / owner-backbone" },
    { query: "current availability", answered_without_ai: knowledge.some((k) =>
        k.fields.find((f) => f.field === "AVAILABILITY")?.status === "KNOWN"), canonical_authority: "machine-model:graph" },
    { query: "current executability", answered_without_ai: knowledge.every((k) =>
        k.fields.find((f) => f.field === "EXECUTABILITY")?.status === "KNOWN"), canonical_authority: "machine-model:self-tool" },
    { query: "block reasons", answered_without_ai: knowledge.some((k) => k.block_reasons.length > 0),
      canonical_authority: "machine-model:self-tool" },
    { query: "knowledge gaps", answered_without_ai: knowledge.some((k) =>
        k.fields.some((f) => f.defect_class !== null)), canonical_authority: "machine-model:self-knowledge" },
  ];
  return { proofs, forbidden_imports: forbidden };
}

// ─────────────────────── PHASE 8 — ช่องว่างที่เหลือ ───────────────────────

export interface RemainingGap {
  readonly capability_id: string;
  readonly missing_fact_type: KnowledgeField;
  readonly defect_class: DefectClass;
  readonly canonical_authority: string | null;
  readonly available_evidence: readonly string[];
  readonly missing_evidence: string;
  readonly why_required: string;
  readonly owner_question_blocked: string;
}

const FIELD_QUESTION: Readonly<Record<KnowledgeField, string>> = {
  IDENTITY: "มึงคืออะไร", PURPOSE: "เครื่องมือนี้มีไว้ทำอะไร", OWNER_ACTION: "กูสั่งมันยังไง",
  INPUT_CONTRACT: "มันรับอะไร", OUTPUT_CONTRACT: "มันส่งอะไร",
  INVOCATION_BOUNDARY: "สั่งผ่านอะไร", CALLER: "ใครสั่งมันได้", EXECUTOR: "ใครลงมือ",
  RUNTIME: "มันทำงานอยู่ที่ไหน", PROCESS: "มันทำงานอยู่ที่ไหน",
  REQUIRED_RESOURCES: "มันพึ่งอะไร", AUTHORITY: "ใครอนุญาต",
  AVAILABILITY: "ตอนนี้พร้อมไหม", EXECUTABILITY: "ตอนนี้ใช้ได้ไหม", EVIDENCE: "อะไรพิสูจน์",
};

const FIELD_REASON: Readonly<Record<KnowledgeField, string>> = {
  IDENTITY: "ไม่มีตัวตน ก็อ้างถึงไม่ได้",
  PURPOSE: "ไม่รู้ว่ามีไว้ทำอะไร ก็ตัดสินไม่ได้ว่าควรใช้เมื่อไร",
  OWNER_ACTION: "Owner สั่งไม่ได้ถ้าไม่มีคำสั่งที่ประกาศไว้",
  INPUT_CONTRACT: "ส่งอะไรเข้าไปไม่ได้ถ้าไม่รู้ว่ามันรับอะไร",
  OUTPUT_CONTRACT: "ตรวจผลไม่ได้ถ้าไม่รู้ว่ามันคืนอะไร",
  INVOCATION_BOUNDARY: "ไม่มีทางเข้า ก็เรียกไม่ได้",
  CALLER: "ไม่รู้ว่าใครเรียกได้ ก็ควบคุมการเข้าถึงไม่ได้",
  EXECUTOR: "ไม่รู้ว่าใครลงมือ ก็หาผู้รับผิดชอบไม่ได้เมื่อพัง",
  RUNTIME: "ไม่รู้ว่ารันด้วยอะไร ก็ตรวจความพร้อมไม่ได้",
  PROCESS: "ไม่รู้ว่ารันอยู่ที่ไหน ก็กู้คืนไม่ได้",
  REQUIRED_RESOURCES: "ไม่รู้ว่าพึ่งอะไร ก็ประเมินผลกระทบไม่ได้",
  AUTHORITY: "ไม่รู้ว่าใครอนุญาต ก็แยกคำสั่งที่ชอบธรรมออกจากที่ไม่ชอบธรรมไม่ได้",
  AVAILABILITY: "ไม่รู้ว่าพร้อมไหม ก็สัญญากับ Owner ไม่ได้",
  EXECUTABILITY: "ไม่รู้ว่าใช้ได้ไหม ก็วางแผนงานไม่ได้",
  EVIDENCE: "ไม่มีหลักฐาน คำตอบทุกข้อข้างบนก็ตรวจสอบไม่ได้",
};

/**
 * ทุกช่องที่ยังขาด พร้อมชนิดข้อบกพร่องและคำถามที่มันบล็อกอยู่
 *
 * รวมถึงแถวของตัวจัดเส้นทางที่ประกาศ endpoint ไว้จริง แต่ยังผูกกับความสามารถใน
 * ทะเบียนไม่ได้ — เป็นคำประกาศที่มีอยู่แต่ไม่มีเจ้าของ ไม่ใช่ของที่ไม่เคยมีใครบันทึก
 */
export function remainingGaps(knowledge: readonly CapabilityKnowledge[]): readonly RemainingGap[] {
  const out: RemainingGap[] = [];
  const bound = new Set(projectDeclaredInvocations()
    .filter((d) => d.evidence_ref.startsWith("command-router:"))
    .map((d) => d.evidence_ref.split(":").pop()));
  for (const r of listCapabilities() as unknown as readonly Record<string, any>[]) {
    const routerName = String(r.capability_id);
    if (bound.has(routerName)) continue;
    out.push({
      capability_id: `command-router:${routerName}`,
      missing_fact_type: "IDENTITY", defect_class: "DECLARED_NOT_BOUND",
      canonical_authority: "software/registry-database/data/canonical/capabilities.jsonl",
      available_evidence: [`command-router:capability-registry:${routerName}`,
        `endpoint.kind=${(r.endpoint ?? {}).kind}`, `health_status=${r.health_status}`],
      missing_evidence: `ไม่มีความสามารถใดในทะเบียน canonical ที่ ${routerName} ผูกอยู่ และ contract/endpoint ที่ประกาศไว้ก็ไม่มีเจ้าของในทะเบียน`,
      why_required: "คำสั่งที่ Owner เรียกได้ ต้องชี้ไปยังความสามารถที่มีตัวตนจริง",
      owner_question_blocked: "กูสั่งมันยังไง",
    });
  }
  for (const k of knowledge) {
    for (const f of k.fields) {
      if (f.status !== "MISSING" || f.defect_class === null) continue;
      out.push({
        capability_id: k.capability_id, missing_fact_type: f.field, defect_class: f.defect_class,
        canonical_authority: f.canonical_authority,
        available_evidence: f.evidence.filter((e) => e.length > 0),
        missing_evidence: `ยังไม่มีแถวใดใน ${f.canonical_authority ?? "ทะเบียนใด"} ที่ให้ค่าช่องนี้กับ ${k.capability_id}`,
        why_required: FIELD_REASON[f.field],
        owner_question_blocked: FIELD_QUESTION[f.field],
      });
    }
  }
  return out;
}
