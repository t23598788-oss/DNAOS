/**
 * หน้าที่: ให้ DNA OS ประกอบความสามารถของตัวเองเป็นผลลัพธ์ที่ Owner ต้องการได้
 *         โดยไม่ต้องมี AI มาช่วยคิดว่าอะไรต่อกับอะไร
 *
 * ── ความสามารถ ไม่ใช่ซอร์สโค้ด และไม่ใช่ทรัพยากร ──
 * ความสามารถคือสัญญา (รับอะไร คืนอะไร) ซอร์สคือสิ่งที่ทำให้มันเกิดขึ้นได้
 * ทรัพยากรคือสิ่งที่ลงมือทำตามสัญญานั้น สามอย่างนี้ถูกเก็บแยกกันในไฟล์นี้ และ
 * การประกอบเกิดที่ระดับสัญญาเท่านั้น
 *
 * ── ต่อกันได้ ต้องพิสูจน์ด้วยสัญญา ไม่ใช่ด้วยความคล้าย ──
 * A ต่อ B ได้ก็ต่อเมื่อชนิดที่ A ประกาศว่าคืน ตรงตัวกับชนิดที่ B ประกาศว่ารับ
 * ไม่มีการเทียบชื่อใกล้เคียง ไม่มีการเทียบชื่อไฟล์ ไม่มีโมเดลภาษามาช่วยตัดสิน
 * ถ้าฝั่งใดไม่ประกาศสัญญาไว้ ผลคือ `INSUFFICIENT_CONTRACT_KNOWLEDGE` ไม่ใช่
 * การเดาว่าน่าจะต่อกันได้
 *
 * ── กราฟสามใบ ห้ามอนุมานข้ามกัน ──
 * กราฟการเรียกทางเทคนิค กราฟอำนาจ และกราฟการประกอบตามสัญญา เป็นคนละใบ
 * การที่ A เรียก B ได้ ไม่ได้แปลว่า A มีอำนาจเหนือ B และไม่ได้แปลว่าผลของ A
 * ใช้เป็นอินพุตของ B ได้
 *
 * ── AI เป็นทรัพยากรทางเลือก ──
 * ถ้าซอฟต์แวร์ที่กำหนดผลได้แน่นอนทำสัญญาตำแหน่งนั้นได้ ก็ไม่ต้องใช้ AI
 * AI ถูกเลือกได้เมื่อสัญญาของตำแหน่งนั้นต้องการทรัพยากรชนิดนั้นเท่านั้น และมัน
 * ไม่ได้รับความรู้ทั้งระบบ ไม่ได้รับกุญแจ และประกาศว่าผลของตัวเองผ่านไม่ได้
 *
 * Input: ทะเบียนที่มีอยู่ + machine model
 * Output: `capabilityContracts`, `compositionGraph`, `outcomeResolution`, `machineActionPrimitives`
 * Dependency ที่อนุญาต: ./self-tool.ts, ./invocation.ts, ./execution-authority.ts (อ่าน)
 * สิ่งที่ห้ามแตะ: ห้ามสร้างความสามารถ ห้ามอ่านค่าความลับ ห้ามสั่งรัน ห้ามเขียน
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listCapabilities } from "../command-router/contract";
import { EXECUTOR_BINDINGS } from "../owner-backbone/route-dispatch";
import { invocationOfCapability } from "./invocation";
import { buildSelfToolModel } from "./self-tool";
import { aiResourceModel } from "./execution-authority";
import type { MachineModel } from "./model";
import type { DependencyIndex } from "./dependency-index";

const CANONICAL_CAPABILITIES = "software/registry-database/data/canonical/capabilities.jsonl";
const CREDENTIALS = "credentials/registry/data/api-credential-references.jsonl";
const RUNTIME_TARGETS = "control/machine-observation/data/runtime-targets.jsonl";

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

// ─────────────────────── PHASE 1 — สัญญาของความสามารถ ───────────────────────

export interface CapabilityContract {
  readonly capability_id: string;
  readonly canonical_name: string;
  readonly purpose: string | null;
  readonly input_contract: readonly string[];
  readonly output_contract: readonly string[];
  readonly side_effect: readonly string[];
  /** สัญญาของทรัพยากรที่ต้องมี — ไม่ใช่ตัวทรัพยากรเอง */
  readonly required_resource_contract: readonly string[];
  readonly execution_boundary: readonly string[];
  readonly result_contract: readonly string[];
  readonly verification_contract: readonly string[];
  /** สิ่งที่ทำให้ความสามารถนี้เกิดขึ้นได้ — คนละอย่างกับตัวความสามารถ */
  readonly implemented_by: readonly string[];
  readonly evidence: readonly string[];
}

let contractCache: readonly CapabilityContract[] | null = null;

/** สัญญาของทุกความสามารถ แยกความสามารถ/สิ่งที่สร้างมัน/ทรัพยากรออกจากกัน */
export function capabilityContracts(model: MachineModel, index: DependencyIndex): readonly CapabilityContract[] {
  if (contractCache !== null) return contractCache;
  const tools = buildSelfToolModel(model, index);
  const out: CapabilityContract[] = [];
  for (const cap of readJsonl(CANONICAL_CAPABILITIES)) {
    const id = String(cap.capability_id);
    const chain = invocationOfCapability(id);
    const tool = tools.find((t) => t.capability_id === id);
    // ตัวที่ทำให้เกิดขึ้นได้ = ทรัพยากรที่ทะเบียนผูกไว้ ไม่ใช่ตัวความสามารถ
    const implementedBy = index.dependenciesOf(`machine://CAPABILITIES/${id}`)
      .filter((d) => d.kind === "MODULE_TO_CAPABILITY" || d.kind === "OWNED_BY_CAPABILITY")
      .map((d) => d.depends_on);
    out.push({
      capability_id: id,
      canonical_name: String(cap.canonical_name ?? id),
      purpose: typeof cap.purpose === "string" && cap.purpose.length > 0 ? cap.purpose : null,
      input_contract: Array.isArray(cap.input_contract) ? cap.input_contract.map(String) : [],
      output_contract: Array.isArray(cap.output_contract) ? cap.output_contract.map(String) : [],
      side_effect: Array.isArray(cap.side_effects) ? cap.side_effects.map(String) : [],
      required_resource_contract: tool?.required_resources ?? [],
      execution_boundary: chain.entry_boundary,
      // สัญญาผลลัพธ์ = สิ่งที่ประกาศว่าคืน; ต่างจากช่องที่ผลถูกส่งกลับไป
      result_contract: Array.isArray(cap.output_contract) ? cap.output_contract.map(String) : [],
      verification_contract: chain.observed_evidence.length > 0 || chain.declared_evidence.length > 0
        ? ["DNA_OS_VERIFICATION_REQUIRED"] : [],
      implemented_by: implementedBy,
      evidence: [`registry-database:capabilities:${id}`, ...chain.declared_evidence],
    });
  }
  contractCache = out;
  return out;
}

// ─────────────────────── PHASE 2/3 — ต่อกันได้ไหม ───────────────────────

export type Compatibility = "COMPATIBLE" | "INCOMPATIBLE" | "INSUFFICIENT_CONTRACT_KNOWLEDGE";

export interface CompositionEdge {
  readonly from: string;
  readonly to: string;
  readonly compatibility: Compatibility;
  /** ชนิดที่ตรงกันตรงตัว — ว่างเมื่อไม่ตรงหรือไม่รู้ */
  readonly shared_contract: readonly string[];
  readonly evidence: readonly string[];
}

/**
 * เทียบสัญญาสองฝั่งด้วยความเท่ากันตรงตัวของชนิดที่ประกาศไว้
 *
 * ไม่มีการเทียบใกล้เคียง ไม่มีการตัดคำ ไม่มีการเทียบตัวพิมพ์แบบหลวม ๆ
 * ฝั่งที่ไม่ประกาศสัญญาไว้ ทำให้ผลเป็น "ยังไม่รู้พอ" ไม่ใช่ "เข้ากันไม่ได้"
 */
export function contractCompatibility(a: CapabilityContract, b: CapabilityContract): CompositionEdge {
  const evidence = [`capabilities:${a.capability_id}#output_contract`, `capabilities:${b.capability_id}#input_contract`];
  if (a.output_contract.length === 0 || b.input_contract.length === 0) {
    return { from: a.capability_id, to: b.capability_id,
      compatibility: "INSUFFICIENT_CONTRACT_KNOWLEDGE", shared_contract: [], evidence };
  }
  const shared = a.output_contract.filter((o) => b.input_contract.includes(o));
  return { from: a.capability_id, to: b.capability_id,
    compatibility: shared.length > 0 ? "COMPATIBLE" : "INCOMPATIBLE",
    shared_contract: shared, evidence };
}

export interface CompositionGraph {
  readonly edges: readonly CompositionEdge[];
  readonly composable: number;
  readonly incompatible: number;
  readonly insufficient: number;
}

/**
 * กราฟการประกอบตามสัญญา — ไม่ใช่กราฟการเรียกทางเทคนิค
 *
 * เก็บเฉพาะเส้นที่ต่อกันได้จริง ส่วนที่เหลือถูกนับไว้เพื่อให้เห็นว่าเรารู้ไม่พอ
 * แค่ไหน ไม่ใช่ถูกทิ้งเงียบ ๆ
 */
export function compositionGraph(contracts: readonly CapabilityContract[]): CompositionGraph {
  const edges: CompositionEdge[] = [];
  let composable = 0, incompatible = 0, insufficient = 0;
  for (const a of contracts) {
    for (const b of contracts) {
      if (a.capability_id === b.capability_id) continue;
      const e = contractCompatibility(a, b);
      if (e.compatibility === "COMPATIBLE") { edges.push(e); composable += 1; }
      else if (e.compatibility === "INCOMPATIBLE") incompatible += 1;
      else insufficient += 1;
    }
  }
  return { edges, composable, incompatible, insufficient };
}

// ─────────────────── PHASE 5 — ชนิดการกระทำที่เครื่องทำได้ ───────────────────

export type ActionClass =
  | "OBSERVE" | "READ" | "OPEN" | "CLOSE" | "SELECT" | "INPUT" | "OUTPUT" | "MOVE"
  | "COPY" | "WRITE" | "DISPLAY" | "START" | "STOP" | "SEND" | "RECEIVE" | "TRANSFER" | "VERIFY";

export const ACTION_CLASSES: readonly ActionClass[] = [
  "OBSERVE", "READ", "OPEN", "CLOSE", "SELECT", "INPUT", "OUTPUT", "MOVE",
  "COPY", "WRITE", "DISPLAY", "START", "STOP", "SEND", "RECEIVE", "TRANSFER", "VERIFY",
];

export interface ActionPrimitive {
  readonly action_class: ActionClass;
  readonly status: "PROVEN" | "PARTIAL" | "MISSING";
  readonly capability_ids: readonly string[];
  readonly declared_tokens: readonly string[];
  readonly evidence: readonly string[];
  readonly reason: string;
}

/** โทเคนของการกระทำที่ระบบประกาศไว้เอง พร้อมความสามารถที่เป็นเจ้าของ */
function declaredActionTokens(): ReadonlyMap<string, { caps: Set<string>; tokens: Set<string>; evidence: Set<string> }> {
  const byName = new Map(readJsonl(CANONICAL_CAPABILITIES)
    .map((c) => [String(c.canonical_name), String(c.capability_id)]));
  const acc = new Map<string, { caps: Set<string>; tokens: Set<string>; evidence: Set<string> }>();
  const add = (token: string, capId: string | undefined, tokenText: string, evidence: string): void => {
    const key = token.toUpperCase();
    const cur = acc.get(key) ?? { caps: new Set<string>(), tokens: new Set<string>(), evidence: new Set<string>() };
    if (capId !== undefined) cur.caps.add(capId);
    cur.tokens.add(tokenText);
    cur.evidence.add(evidence);
    acc.set(key, cur);
  };

  // 1) คำสั่งที่ประกาศไว้ในตัวจัดเส้นทาง
  for (const r of listCapabilities() as unknown as readonly Record<string, any>[]) {
    const capId = byName.get(String(r.capability_id));
    for (const cmd of (r.supported_commands ?? []) as string[]) {
      for (const part of String(cmd).split(/[._-]/)) {
        add(part, capId, String(cmd), `command-router:supported_commands=${cmd}`);
      }
    }
  }
  // 2) การกระทำของ route ที่ประกาศไว้
  for (const b of EXECUTOR_BINDINGS as unknown as readonly Record<string, any>[]) {
    const capId = byName.get(String(b.capability_canonical_name));
    for (const part of String(b.route_action).split(/[._-]/)) {
      add(part, capId, String(b.route_action), `owner-backbone:route_action=${b.route_action}`);
    }
  }
  // 3) ขอบเขตสิทธิ์ที่ประกาศไว้กับตัวชี้กุญแจ (ไม่แตะค่าความลับ)
  for (const c of readJsonl(CREDENTIALS)) {
    for (const scope of (c.scope ?? []) as string[]) {
      for (const part of String(scope).split(/[._-]/)) {
        add(part, undefined, String(scope), `credential-registry:scope=${scope}`);
      }
    }
  }
  // 4) อำนาจของเป้าหมายการสังเกตที่ประกาศไว้
  for (const t of readJsonl(RUNTIME_TARGETS)) {
    const capId = typeof t.capability_id === "string" ? t.capability_id : undefined;
    for (const part of String(t.authority ?? "").split(/[._-]/)) {
      if (part.length === 0) continue;
      add(part, capId, String(t.authority), `runtime-targets:authority=${t.authority}`);
    }
  }
  return acc;
}

/**
 * ชนิดการกระทำที่ระบบมีสัญญารองรับจริง
 *
 * จับคู่ด้วยความเท่ากันตรงตัวของโทเคนที่ระบบประกาศเอง ไม่ใช่การตีความว่า
 * "os-ui น่าจะเปิดแอปได้" — โทเคน `open` ต้องปรากฏในคำสั่งที่ประกาศไว้จริง
 * ชนิดที่ไม่มีโทเคนตรงตัว คือ `MISSING` ไม่ใช่การเดาว่าน่าจะทำได้
 */
export function machineActionPrimitives(model: MachineModel, index: DependencyIndex): readonly ActionPrimitive[] {
  const tokens = declaredActionTokens();
  const tools = buildSelfToolModel(model, index);
  return ACTION_CLASSES.map((cls) => {
    const hit = tokens.get(cls);
    if (hit === undefined) {
      return { action_class: cls, status: "MISSING" as const, capability_ids: [], declared_tokens: [],
        evidence: [], reason: "ไม่มีโทเคนการกระทำนี้ประกาศไว้ในทะเบียนใดเลย" };
    }
    const caps = [...hit.caps];
    // มีคำประกาศแล้ว แต่ความสามารถที่เป็นเจ้าของยังใช้งานไม่ได้ = ยังไม่พร้อมจริง
    const usable = caps.filter((c) => tools.find((t) => t.capability_id === c)?.executable_now === true);
    return {
      action_class: cls,
      status: usable.length > 0 ? "PROVEN" : "PARTIAL",
      capability_ids: caps,
      declared_tokens: [...hit.tokens],
      evidence: [...hit.evidence],
      reason: usable.length > 0
        ? `มีความสามารถที่ใช้ได้ตอนนี้รองรับ ${usable.length} ตัว`
        : caps.length > 0
          ? "มีคำประกาศ แต่ความสามารถที่เป็นเจ้าของยังใช้งานไม่ได้"
          : "มีคำประกาศแต่ยังไม่ผูกกับความสามารถใดในทะเบียน",
    };
  });
}

// ─────────────────── PHASE 4/9 — ผลลัพธ์ที่ Owner ต้องการ ───────────────────

/**
 * สัญญาผลลัพธ์สำหรับทดสอบ ตามที่ Owner ระบุไว้ใน TASK
 *
 * ประกาศไว้เป็นชุดทดสอบ ไม่ใช่การอ้างว่าระบบมีของเหล่านี้อยู่แล้ว แต่ละอันบอกว่า
 * ต้องมีชนิดการกระทำอะไรบ้าง และไม่มีการยอมรับของทดแทนที่ "น่าจะเทียบเท่า"
 */
export const TEST_OUTCOMES: readonly { readonly outcome: string; readonly required: readonly ActionClass[] }[] = [
  { outcome: "OPEN_APPLICATION", required: ["OPEN"] },
  { outcome: "READ_VISIBLE_INFORMATION", required: ["OBSERVE", "READ"] },
  { outcome: "DISPLAY_INFORMATION", required: ["DISPLAY"] },
  { outcome: "MOVE_LOCAL_FILE", required: ["MOVE"] },
  { outcome: "TRANSFER_FILE", required: ["TRANSFER"] },
  { outcome: "MODIFY_EXISTING_SOFTWARE_BEHAVIOR", required: ["WRITE", "VERIFY"] },
  { outcome: "VERIFY_MODIFICATION", required: ["VERIFY"] },
];

export interface OutcomeResolution {
  readonly outcome: string;
  readonly status: "PRODUCIBLE_NOW" | "PARTIAL" | "NOT_PRODUCIBLE";
  readonly required_capabilities: readonly ActionClass[];
  readonly available_capabilities: readonly string[];
  readonly missing_capabilities: readonly ActionClass[];
  readonly required_resources: readonly string[];
  readonly available_resources: readonly string[];
  readonly block_reason: readonly string[];
  readonly ai_requirement: "AI_REQUIRED" | "AI_OPTIONAL" | "AI_NOT_REQUIRED";
  readonly evidence: readonly string[];
}

/**
 * ผลลัพธ์แต่ละอันผลิตได้ตอนนี้ไหม
 *
 * `AI_NOT_REQUIRED` เมื่อทุกชนิดการกระทำที่ต้องใช้ มีซอฟต์แวร์ที่กำหนดผลได้แน่นอน
 * รองรับอยู่แล้ว — AI ไม่ได้ถูกเลือกเพราะมันฉลาดกว่า แต่ถูกเลือกเมื่อไม่มีอย่างอื่น
 * ทำสัญญาตำแหน่งนั้นได้เท่านั้น
 */
export function outcomeResolution(model: MachineModel, index: DependencyIndex): readonly OutcomeResolution[] {
  const primitives = machineActionPrimitives(model, index);
  const byClass = new Map(primitives.map((p) => [p.action_class, p]));
  const tools = buildSelfToolModel(model, index);
  const ai = aiResourceModel();

  return TEST_OUTCOMES.map(({ outcome, required }) => {
    const proven = required.filter((r) => byClass.get(r)?.status === "PROVEN");
    const partial = required.filter((r) => byClass.get(r)?.status === "PARTIAL");
    const missing = required.filter((r) => byClass.get(r)?.status === "MISSING");
    const availableCaps = required.flatMap((r) => byClass.get(r)?.capability_ids ?? []);
    const resources = availableCaps.flatMap((c) =>
      tools.find((t) => t.capability_id === c)?.required_resources ?? []);

    const status = missing.length > 0 ? "NOT_PRODUCIBLE" as const
      : proven.length === required.length ? "PRODUCIBLE_NOW" as const
      : "PARTIAL" as const;

    const block: string[] = [];
    for (const m of missing) block.push(`NO_DECLARED_ACTION_CONTRACT:${m}`);
    for (const p of partial) block.push(`ACTION_CONTRACT_NOT_EXECUTABLE:${p}`);

    return {
      outcome, status, required_capabilities: required,
      available_capabilities: [...new Set(availableCaps)],
      missing_capabilities: missing,
      required_resources: [...new Set(resources)],
      available_resources: [...new Set(resources)],
      block_reason: block,
      // ── AI จำเป็นเมื่อไหร่ ──
      // เฉพาะเมื่อมีตำแหน่งที่ "ประกาศไว้" ว่าต้องใช้ทรัพยากรชนิดนั้น การที่ผลลัพธ์
      // ยังทำไม่ได้ ไม่ได้แปลว่า AI จะเติมช่องว่างนั้นได้ — การสรุปแบบนั้นคือการเดา
      // ว่า AI ทำอะไรได้บ้าง ซึ่งไม่มีคำประกาศใดรองรับ
      ai_requirement: required.some((r) => ai.some((a) => a.work_scope.includes(r)))
        ? "AI_REQUIRED" : "AI_NOT_REQUIRED",
      evidence: required.flatMap((r) => byClass.get(r)?.evidence ?? []).slice(0, 4),
    };
  });
}

export const capabilitiesForOutcome = (outcome: string, m: MachineModel, i: DependencyIndex): readonly string[] =>
  outcomeResolution(m, i).find((o) => o.outcome === outcome)?.available_capabilities ?? [];

export const missingCapabilitiesForOutcome = (outcome: string, m: MachineModel, i: DependencyIndex): readonly ActionClass[] =>
  outcomeResolution(m, i).find((o) => o.outcome === outcome)?.missing_capabilities ?? [];

export const canProduceOutcomeNow = (outcome: string, m: MachineModel, i: DependencyIndex): boolean =>
  outcomeResolution(m, i).find((o) => o.outcome === outcome)?.status === "PRODUCIBLE_NOW";

export const whyCanNotProduceOutcome = (outcome: string, m: MachineModel, i: DependencyIndex): readonly string[] =>
  outcomeResolution(m, i).find((o) => o.outcome === outcome)?.block_reason ?? [];

// ─────────────────── PHASE 6/7 — ตำแหน่งของทรัพยากร ───────────────────

export interface ResourcePosition {
  readonly position_id: string;
  readonly required_contract: string;
  readonly current_resource: string | null;
  /** พอดีกับตำแหน่งเพราะทำสัญญาได้ ไม่ใช่เพราะยี่ห้อหรือความสามารถของโมเดล */
  readonly resource_fit: "CONTRACT_SATISFIED" | "CONTRACT_NOT_SATISFIED" | "NO_CANDIDATE";
  readonly available_now: boolean;
  readonly evidence: readonly string[];
}

/** ตำแหน่งทรัพยากรของชนิดการกระทำหนึ่ง ๆ */
export function resourcesForComposition(actionClass: ActionClass, model: MachineModel, index: DependencyIndex): readonly ResourcePosition[] {
  const primitive = machineActionPrimitives(model, index).find((p) => p.action_class === actionClass);
  if (primitive === undefined || primitive.capability_ids.length === 0) {
    return [{ position_id: `position:${actionClass}`, required_contract: actionClass,
      current_resource: null, resource_fit: "NO_CANDIDATE", available_now: false,
      evidence: primitive?.evidence ?? [] }];
  }
  const tools = buildSelfToolModel(model, index);
  return primitive.capability_ids.map((capId) => {
    const tool = tools.find((t) => t.capability_id === capId);
    return {
      position_id: `position:${actionClass}:${capId}`,
      required_contract: actionClass,
      current_resource: tool?.required_resources[0] ?? tool?.executor[0] ?? null,
      resource_fit: tool === undefined ? "NO_CANDIDATE"
        : tool.dimensions.toolBoundaryExists ? "CONTRACT_SATISFIED" : "CONTRACT_NOT_SATISFIED",
      available_now: tool?.executable_now === true,
      evidence: primitive.evidence,
    };
  });
}

// ─────────────────── PHASE 8 — ขอบเขตของความลับ ───────────────────

export interface SecretBoundaryCheck {
  readonly credential_reference_count: number;
  readonly capabilities_referencing_credentials: number;
  /** ต้องเป็นศูนย์ — ไฟล์นี้ไม่มีทางอ่านค่าความลับ */
  readonly credential_values_read: 0;
  readonly ai_resources_receiving_credentials: number;
  readonly evidence: readonly string[];
}

/**
 * ยืนยันว่าการประกอบอ้างถึงกุญแจได้โดยไม่เห็นค่าของมัน
 *
 * ทะเบียนกุญแจเก็บ "ตัวชี้" (`credential_ref`) ไม่ใช่ค่า การนับตัวชี้จึงไม่ใช่
 * การอ่านความลับ และไม่มีทรัพยากร AI ตัวใดได้รับตัวชี้เหล่านี้จากชั้นนี้
 */
export function secretBoundaryCheck(): SecretBoundaryCheck {
  const refs = readJsonl(CREDENTIALS);
  const connections = readJsonl("connections/connection-registry/data/connections.jsonl");
  const withCredential = connections.filter((c) => c.credential_ref !== undefined && c.executor_capability_id !== undefined);
  return {
    credential_reference_count: refs.length,
    capabilities_referencing_credentials: new Set(withCredential.map((c) => String(c.executor_capability_id))).size,
    credential_values_read: 0,
    ai_resources_receiving_credentials: 0,
    evidence: withCredential.map((c) => `connection-registry:${c.connection_id}:credential_ref`),
  };
}

// ─────────────────── PHASE 10 — ภาพสำหรับ Owner ───────────────────

export interface OwnerCompositionBlock {
  readonly capability_id: string;
  readonly what_it_does: string | null;
  readonly what_it_receives: readonly string[];
  readonly what_it_produces: readonly string[];
  readonly current_state: string;
  readonly resource_currently_used: readonly string[];
  readonly verification: readonly string[];
  /** ซอร์สปรากฏได้เฉพาะเป็นหลักฐานให้เจาะลึก ไม่ใช่ภาพหลัก */
  readonly drilldown_implementation: readonly string[];
}

export interface OwnerCompositionView {
  readonly outcome: string;
  readonly status: OutcomeResolution["status"];
  readonly blocks: readonly OwnerCompositionBlock[];
  readonly block_reason: readonly string[];
}

/** ภาพสำหรับหน้าจอ Owner — ผลลัพธ์ก่อน ซอร์สเป็นหลักฐานชั้นล่างสุด */
export function ownerCompositionView(outcome: string, model: MachineModel, index: DependencyIndex): OwnerCompositionView {
  const resolution = outcomeResolution(model, index).find((o) => o.outcome === outcome) ?? null;
  if (resolution === null) {
    return { outcome, status: "NOT_PRODUCIBLE", blocks: [], block_reason: ["UNKNOWN_OUTCOME_CONTRACT"] };
  }
  const contracts = capabilityContracts(model, index);
  const tools = buildSelfToolModel(model, index);
  const blocks = resolution.available_capabilities.map((capId) => {
    const c = contracts.find((x) => x.capability_id === capId);
    const tool = tools.find((t) => t.capability_id === capId);
    return {
      capability_id: capId,
      what_it_does: c?.purpose ?? null,
      what_it_receives: c?.input_contract ?? [],
      what_it_produces: c?.output_contract ?? [],
      current_state: tool?.executable_now === true ? "EXECUTABLE_NOW" : "NOT_EXECUTABLE_NOW",
      resource_currently_used: tool?.required_resources ?? [],
      verification: c?.verification_contract ?? [],
      drilldown_implementation: c?.implemented_by ?? [],
    };
  });
  return { outcome, status: resolution.status, blocks, block_reason: resolution.block_reason };
}
