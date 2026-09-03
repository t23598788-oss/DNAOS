/**
 * หน้าที่: ตอบว่า DNA OS มีเครื่องมืออะไรของตัวเอง และตอนนี้ใช้ได้จริงตัวไหน
 *
 * ── "มีความสามารถ" ไม่เท่ากับ "มีเครื่องมือ" ──
 * แถวหนึ่งในทะเบียนความสามารถ บอกได้แค่ว่ามีของอยู่ ไม่ได้บอกว่าสั่งมันยังไง
 * เครื่องมือเกิดขึ้นเมื่อมีขอบเขตที่ลงมือได้จริงผูกอยู่ ไฟล์นี้จึงแยกแปดมิติออก
 * จากกัน และไม่ยุบเป็นค่าจริง/เท็จค่าเดียว เพราะการยุบคือวิธีที่ระบบตอบว่า
 * "ใช้ได้" ทั้งที่ไม่มีใครรู้ว่าจะเรียกมันยังไง
 *
 * ── EXECUTABLE_NOW ถูกคำนวณ ห้ามตั้งเอง ──
 * ไม่มีทางใดในไฟล์นี้รับค่า `executable_now` จากภายนอก มันเป็นผลของเงื่อนไข
 * ที่พิสูจน์ได้ทั้งหมดเท่านั้น การมีแถวในทะเบียน การมีซอฟต์แวร์ติดตั้งไว้ และ
 * การเคยรันเมื่อวาน ไม่ทำให้อะไรใช้ได้ตอนนี้
 *
 * ── เคยรันแล้ว ไม่ใช่เงื่อนไขของการใช้ได้ ──
 * เครื่องมือที่ประกาศครบ มีของพร้อม และได้รับอนุญาต ใช้ได้แม้ Owner ไม่เคย
 * เรียกมันมาก่อน `executionObserved` จึงเป็นมิติที่รายงานแยก ไม่ใช่เงื่อนไข
 *
 * ── คำอธิบายสำหรับคนต้องมาจากช่องในทะเบียน ──
 * `OWNER_ACTION` เกิดได้เมื่อมีคำสั่งที่ประกาศไว้จริงเท่านั้น ไม่มีที่ใดแต่ง
 * ชื่อที่อ่านง่ายจากชื่อไฟล์ ถ้าไม่พอ ผลคือ `OWNER_REPRESENTATION_GAP`
 *
 * Input: `MachineModel` + `DependencyIndex`
 * Output: `buildSelfToolModel`, `toolsOfDNAOS`, `whatCanIDoNow`, ...
 * Dependency ที่อนุญาต: ./invocation.ts, ./model.ts, command-router, owner-backbone (อ่าน)
 * สิ่งที่ห้ามแตะ: ห้ามสร้าง capability ห้ามเขียนทะเบียน ห้ามสั่งรัน ห้ามแต่งคำอธิบาย
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listCapabilities } from "../command-router/contract";
import { EXECUTOR_BINDINGS } from "../owner-backbone/route-dispatch";
import { invocationOfCapability, projectDeclaredInvocations, projectObservedInvocations } from "./invocation";
import type { MachineModel } from "./model";
import type { DependencyIndex } from "./dependency-index";

const CANONICAL_CAPABILITIES = "software/registry-database/data/canonical/capabilities.jsonl";

export type BlockReason =
  | "MISSING_INVOCATION_BOUNDARY" | "MISSING_INPUT_CONTRACT" | "MISSING_OUTPUT_CONTRACT"
  | "MISSING_EXECUTOR" | "MISSING_RUNTIME_BINDING" | "RESOURCE_UNAVAILABLE"
  | "RUNTIME_NOT_RUNNING" | "AUTHORITY_DENIED" | "EXECUTION_DISABLED"
  | "NOT_OBSERVED" | "MODEL_GAP";

/** แปดมิติที่ห้ามยุบรวมกัน */
export interface ToolDimensions {
  readonly capabilityExists: boolean;
  readonly toolBoundaryExists: boolean;
  readonly invocationKnown: boolean;
  readonly executionObserved: boolean;
  readonly resourcesAvailableNow: boolean;
  readonly runtimeAvailableNow: boolean;
  readonly authorityAllowsNow: boolean;
  readonly inputContractKnown: boolean;
  readonly outputContractKnown: boolean;
}

export interface OwnerRepresentation {
  readonly owner_action: string | null;
  readonly purpose: string | null;
  readonly accepts: readonly string[];
  readonly produces: readonly string[];
  readonly current_status: string;
  readonly block_reason: readonly BlockReason[];
  readonly evidence_path: readonly string[];
  readonly gap: "OWNER_REPRESENTATION_GAP" | null;
}

export interface SelfTool {
  readonly capability_id: string;
  readonly canonical_name: string;
  readonly dimensions: ToolDimensions;
  readonly executable_now: boolean;
  readonly block_reasons: readonly BlockReason[];
  readonly entry_boundary: readonly string[];
  readonly executor: readonly string[];
  readonly runtime_resource: readonly string[];
  readonly required_resources: readonly string[];
  readonly input_contract: readonly string[];
  readonly output_contract: readonly string[];
  readonly last_observed_at: string | null;
  readonly evidence_path: readonly string[];
  readonly owner_representation: OwnerRepresentation;
}

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
 * สิทธิ์ที่ประกาศไว้ ณ ตอนนี้
 *
 * `execution_enabled: false` ของตารางผู้ปฏิบัติเป็นการปิดที่ประกาศไว้ชัดเจน
 * (เช่น AUTOMATIC_AGENT_DISPATCH_DISABLED) ต้องอ่านเป็น `EXECUTION_DISABLED`
 * ไม่ใช่ `AUTHORITY_DENIED` — สองอย่างนี้แก้กันคนละวิธี
 */
function authorityOf(canonicalName: string): { allowed: boolean; reason: BlockReason | null; evidence: string[] } {
  const evidence: string[] = [];
  for (const b of EXECUTOR_BINDINGS as unknown as readonly Record<string, any>[]) {
    if (b.capability_canonical_name !== canonicalName) continue;
    evidence.push(`owner-backbone:EXECUTOR_BINDINGS:${b.route_action}:execution_enabled=${b.execution_enabled}`);
    if (b.execution_enabled === false) return { allowed: false, reason: "EXECUTION_DISABLED", evidence };
  }
  for (const c of listCapabilities() as unknown as readonly Record<string, any>[]) {
    if (c.capability_id !== canonicalName) continue;
    evidence.push(`command-router:permission_requirement=${c.permission_requirement}`);
    // `execution-policy` = ต้องผ่านการตัดสินของประตูสิทธิ์ตอนเรียก จึงยังไม่ใช่
    // การอนุญาตล่วงหน้า และไม่ใช่การปฏิเสธ — รายงานเป็นสิทธิ์ที่ยังไม่ตัดสิน
    if (c.permission_requirement === "execution-policy") {
      return { allowed: false, reason: "AUTHORITY_DENIED", evidence };
    }
  }
  return { allowed: evidence.length > 0, reason: evidence.length > 0 ? null : "MODEL_GAP", evidence };
}

let cache: readonly SelfTool[] | null = null;

/** สร้างแบบจำลองเครื่องมือของตัวเองจากข้อเท็จจริงที่มีอยู่ */
export function buildSelfToolModel(model: MachineModel, index: DependencyIndex): readonly SelfTool[] {
  if (cache !== null) return cache;
  const canonical = readJsonl(CANONICAL_CAPABILITIES);
  const declared = projectDeclaredInvocations();
  const observed = projectObservedInvocations();
  const routerRows = listCapabilities() as unknown as readonly Record<string, any>[];

  const tools: SelfTool[] = [];
  for (const cap of canonical) {
    const id = String(cap.capability_id);
    const name = String(cap.canonical_name ?? id);
    const chain = invocationOfCapability(id);
    const myDeclared = declared.filter((d) => d.capability_id === id);
    const myObserved = observed.filter((o) => o.capability_id === id);

    // ทรัพยากรที่ผูกไว้ในกราฟ — ผู้ให้บริการของความสามารถนี้
    const capNode = `machine://CAPABILITIES/${id}`;
    const required = index.dependenciesOf(capNode).map((d) => d.depends_on);
    const nodeIds = new Set(model.nodes.map((n) => n.node_id));
    const resourcesAvailable = required.length > 0 && required.every((r) => nodeIds.has(r));

    const runtimeDeclared = myDeclared.filter((d) => d.kind === "CAPABILITY_RUNS_IN_PROCESS");
    // บริการที่ประกาศไว้ ต้องปรากฏเป็นโหนดบริการที่สำรวจเจอจริงจึงนับว่าพร้อม
    const runtimeAvailable = runtimeDeclared.length === 0
      ? null      // ความสามารถนี้ไม่ได้ประกาศว่าต้องรันในบริการใด
      : runtimeDeclared.every((d) => nodeIds.has(`machine://INSTALLED_SOFTWARE/BACKGROUND_SERVICE/${d.process_service}`));

    const auth = authorityOf(name);
    const inputs = Array.isArray(cap.input_contract) ? cap.input_contract.map(String) : [];
    const outputs = Array.isArray(cap.output_contract) ? cap.output_contract.map(String) : [];

    const dimensions: ToolDimensions = {
      capabilityExists: true,
      toolBoundaryExists: chain.entry_boundary.length > 0 || chain.route.length > 0 || chain.process_service.length > 0,
      invocationKnown: myDeclared.length > 0,
      executionObserved: myObserved.length > 0,
      resourcesAvailableNow: resourcesAvailable,
      runtimeAvailableNow: runtimeAvailable !== false,
      authorityAllowsNow: auth.allowed,
      inputContractKnown: inputs.length > 0,
      outputContractKnown: outputs.length > 0,
    };

    // ── การคำนวณ EXECUTABLE_NOW ──
    // เคยรันมาก่อนไม่ใช่เงื่อนไข ของที่ประกาศครบและพร้อมใช้ ใช้ได้แม้ยังไม่เคยถูกเรียก
    const blockers: BlockReason[] = [];
    if (!dimensions.toolBoundaryExists) blockers.push("MISSING_INVOCATION_BOUNDARY");
    if (!dimensions.invocationKnown && dimensions.toolBoundaryExists) blockers.push("MODEL_GAP");
    if (!dimensions.inputContractKnown) blockers.push("MISSING_INPUT_CONTRACT");
    if (!dimensions.outputContractKnown) blockers.push("MISSING_OUTPUT_CONTRACT");
    if (!dimensions.resourcesAvailableNow) blockers.push("RESOURCE_UNAVAILABLE");
    if (runtimeAvailable === false) blockers.push("RUNTIME_NOT_RUNNING");
    if (auth.reason !== null) blockers.push(auth.reason);
    if (chain.executor.length === 0 && chain.process_service.length === 0) blockers.push("MISSING_EXECUTOR");

    const executableNow = blockers.length === 0;

    // ── ตัวแทนสำหรับ Owner ──
    // `OWNER_ACTION` มาจากคำสั่งที่ประกาศไว้จริงเท่านั้น ไม่มีการแต่งชื่อ
    const routerRow = routerRows.find((r) => r.capability_id === name);
    const routeAction = myDeclared.find((d) => d.route !== null)?.route ?? null;
    const supported = Array.isArray(routerRow?.supported_commands) ? routerRow!.supported_commands.map(String) : [];
    const ownerAction = supported.length > 0 ? supported.join(", ") : routeAction;
    const purpose = typeof cap.purpose === "string" && cap.purpose.length > 0 ? cap.purpose : null;

    const evidence = [
      `registry-database:capabilities:${id}`,
      ...chain.declared_evidence,
      ...chain.observed_evidence,
      ...auth.evidence,
    ];

    tools.push({
      capability_id: id, canonical_name: name, dimensions, executable_now: executableNow,
      block_reasons: blockers,
      entry_boundary: chain.entry_boundary, executor: chain.executor,
      runtime_resource: chain.runtime_resource, required_resources: required,
      input_contract: inputs, output_contract: outputs,
      last_observed_at: chain.last_observed_at, evidence_path: evidence,
      owner_representation: {
        owner_action: ownerAction,
        purpose,
        accepts: inputs,
        produces: outputs,
        current_status: executableNow ? "AVAILABLE_NOW" : "NOT_EXECUTABLE_NOW",
        block_reason: blockers,
        evidence_path: evidence,
        // พอสำหรับคนก็ต่อเมื่อรู้ว่าสั่งยังไง และมันมีไว้ทำอะไร
        gap: ownerAction !== null && purpose !== null ? null : "OWNER_REPRESENTATION_GAP",
      },
    });
  }
  cache = tools;
  return tools;
}

// ─────────────────────────── PHASE 4 — คำถามของระบบ ───────────────────────────

export const toolsOfDNAOS = (m: MachineModel, i: DependencyIndex): readonly SelfTool[] =>
  buildSelfToolModel(m, i).filter((t) => t.dimensions.toolBoundaryExists);

export const whatCanIDoNow = (m: MachineModel, i: DependencyIndex): readonly SelfTool[] =>
  buildSelfToolModel(m, i).filter((t) => t.executable_now);

export const whatCanINotDoNow = (m: MachineModel, i: DependencyIndex): readonly SelfTool[] =>
  buildSelfToolModel(m, i).filter((t) => !t.executable_now);

export const toolFor = (id: string, m: MachineModel, i: DependencyIndex): SelfTool | null =>
  buildSelfToolModel(m, i).find((t) => t.capability_id === id) ?? null;

export const howDoIInvoke = (id: string, m: MachineModel, i: DependencyIndex): readonly string[] => {
  const t = toolFor(id, m, i);
  return t === null ? [] : [...t.owner_representation.owner_action === null ? [] : [t.owner_representation.owner_action],
    ...t.entry_boundary];
};

export const whatDoesItRequire = (id: string, m: MachineModel, i: DependencyIndex): readonly string[] => {
  const t = toolFor(id, m, i);
  return t === null ? [] : [...t.input_contract, ...t.required_resources];
};

export const whatWillItProduce = (id: string, m: MachineModel, i: DependencyIndex): readonly string[] =>
  toolFor(id, m, i)?.output_contract ?? [];

export const whyCanIUseItNow = (id: string, m: MachineModel, i: DependencyIndex): readonly string[] => {
  const t = toolFor(id, m, i);
  if (t === null || !t.executable_now) return [];
  return t.evidence_path;
};

export const whyCanINotUseItNow = (id: string, m: MachineModel, i: DependencyIndex): readonly BlockReason[] =>
  toolFor(id, m, i)?.block_reasons ?? [];

// ─────────────────────────── PHASE 7 — ช่องว่างตามชนิดข้อเท็จจริง ───────────────────────────

export interface FactTypeGap {
  readonly missing_fact_type: BlockReason;
  readonly affected_capabilities: number;
  readonly existing_possible_authority_source: string | null;
  readonly observation_boundary_missing: string | null;
  readonly fact_required_to_answer: string;
}

/** จัดกลุ่มสิ่งที่ยังขาด ตามชนิดของข้อเท็จจริง ไม่ใช่ตามจำนวนที่ต้องไปสืบ */
export function knowledgeGapsByFactType(tools: readonly SelfTool[]): readonly FactTypeGap[] {
  const counts = new Map<BlockReason, number>();
  for (const t of tools) for (const b of new Set(t.block_reasons)) counts.set(b, (counts.get(b) ?? 0) + 1);

  const meta: Readonly<Record<BlockReason, { authority: string | null; boundary: string | null; fact: string }>> = {
    MISSING_INVOCATION_BOUNDARY: {
      authority: "control/command-router capability-registry, control/owner-backbone EXECUTOR_BINDINGS",
      boundary: null,
      fact: "ต้องมีแถวที่ประกาศ endpoint/route ของความสามารถนี้ในทะเบียนใดทะเบียนหนึ่งที่มีอยู่" },
    MISSING_INPUT_CONTRACT: {
      authority: "software/registry-database capabilities.input_contract",
      boundary: null,
      fact: "ต้องกรอก input_contract ตอนลงทะเบียนความสามารถ" },
    MISSING_OUTPUT_CONTRACT: {
      authority: "software/registry-database capabilities.output_contract",
      boundary: null,
      fact: "ต้องกรอก output_contract ตอนลงทะเบียนความสามารถ" },
    MISSING_EXECUTOR: {
      authority: "control/owner-backbone EXECUTOR_BINDINGS.target_owner",
      boundary: null,
      fact: "ต้องประกาศว่าใครลงมือทำงานนี้" },
    MISSING_RUNTIME_BINDING: {
      authority: "control/machine-observation runtime-targets.jsonl",
      boundary: null,
      fact: "ต้องประกาศเป้าหมายการรันของความสามารถนี้" },
    RESOURCE_UNAVAILABLE: {
      authority: "software/registry-database resource_capabilities.jsonl",
      boundary: null,
      fact: "ต้องผูกความสามารถกับทรัพยากรที่มีอยู่จริงบนเครื่อง" },
    RUNTIME_NOT_RUNNING: {
      authority: "control/runtime-control SERVICES",
      boundary: null,
      fact: "บริการที่ประกาศไว้ต้องปรากฏใน launchd จริง" },
    AUTHORITY_DENIED: {
      authority: "permissions/execution-policy",
      boundary: null,
      fact: "ต้องมีคำตัดสินสิทธิ์ล่วงหน้า หรือประกาศว่าตัดสินตอนเรียก" },
    EXECUTION_DISABLED: {
      authority: "control/owner-backbone EXECUTOR_BINDINGS.execution_enabled",
      boundary: null,
      fact: "Owner ต้องเปิดการทำงานนั้นอย่างชัดแจ้ง — ไม่ใช่ช่องว่างความรู้" },
    NOT_OBSERVED: {
      authority: "control/agent-gateway evidence.source",
      boundary: "ยังไม่มีผู้บันทึกการเรียกใช้ของความสามารถนี้",
      fact: "ต้องมีหลักฐานการรันที่ผูกกับ capability_id" },
    MODEL_GAP: {
      // เกิดจากสองกรณี: ไม่มีคำประกาศสิทธิ์ใดเลย หรือมีขอบเขตแต่ไม่มีคำประกาศการเรียกใช้
      // ทั้งคู่คือ "ไม่มีใครเคยประกาศ" ไม่ใช่ "ประกาศแล้วว่าห้าม" — คนละเรื่องกับ AUTHORITY_DENIED
      authority: "control/command-router capability-registry, control/owner-backbone EXECUTOR_BINDINGS",
      boundary: "ไม่มีทะเบียนใดประกาศทั้งการเรียกใช้และสิทธิ์ของความสามารถนี้",
      fact: "ต้องมีแถวที่ประกาศว่าใครเรียกได้และเรียกผ่านอะไร ในทะเบียนที่มีอยู่แล้ว" },
  };

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => ({
      missing_fact_type: reason, affected_capabilities: n,
      existing_possible_authority_source: meta[reason].authority,
      observation_boundary_missing: meta[reason].boundary,
      fact_required_to_answer: meta[reason].fact,
    }));
}
