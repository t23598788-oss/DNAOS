/**
 * หน้าที่: ตอบว่าอะไรจำเป็นจริง ๆ และเพราะอะไร โดยไม่มีใครมาบอกว่าอะไรสำคัญ
 *
 * ── ความจำเป็นต้องถูกคำนวณ ไม่ใช่ถูกประกาศ ──
 * ไม่มีรายชื่อ "ของที่ต้องมี" เขียนไว้ในไฟล์นี้ ทุกคำตัดสินมาจากกราฟ: มีอะไร
 * พึ่งมันอยู่ไหม และมีของอื่นที่ทำสัญญาเดียวกันได้ไหม การติดตั้งไว้ การรันอยู่
 * การเคยใช้ และการที่ชื่อมันโผล่ในเอกสาร ไม่ทำให้อะไรจำเป็นเลยสักอย่าง
 *
 * ── ความจำเป็นจบที่สัญญา ไม่ใช่ที่ยี่ห้อ ──
 * `REQUIRED` เกิดได้ทางเดียว: มีความสามารถที่พึ่งมันอยู่ และตอนนี้ยังไม่มีของอื่น
 * ที่ประกาศว่าทำสัญญาเดียวกันได้ ถ้ามีของอื่น มันคือ `REPLACEABLE` ทันที ไม่ว่า
 * ของนั้นจะเป็นของใคร ยี่ห้ออะไร หรือใครถนัดใช้อันไหน
 *
 * ── พิสูจน์ไม่ได้ ต้องดังกว่าพิสูจน์ได้ ──
 * ของที่ไม่มีใครประกาศความสัมพันธ์ให้เลย ได้ `INSUFFICIENT_EVIDENCE` พร้อมชื่อ
 * ข้อเท็จจริงที่ขาด ไม่ใช่ `UNUSED` — เพราะ "ไม่มีใครบอกว่าใช้" กับ "พิสูจน์แล้ว
 * ว่าไม่มีใครใช้" เป็นคนละเรื่อง และการสับสนสองอันนี้คือวิธีที่ระบบลบของที่ยังใช้อยู่
 *
 * ── UNUSED ไม่ได้แปลว่าลบได้ ──
 * ไฟล์นี้ไม่มีทางลบ ไม่มีทางถอน ไม่มีทางแก้ค่า และไม่คืนคำแนะนำให้ลบ
 *
 * Input: `MachineModel` + `DependencyIndex`
 * Output: `evaluateNecessity`, `whyResource`, `whatIfRemoved`, `counterfactualSets`
 * Dependency ที่อนุญาต: ./model.ts, ./dependency-index.ts (อ่านอย่างเดียว)
 * สิ่งที่ห้ามแตะ: ห้ามใช้ชื่อผลิตภัณฑ์ตัดสินความจำเป็น ห้ามเดาเส้นที่ยังไม่ประกาศ
 *                ห้ามเขียนไฟล์ ห้ามเสนอให้ลบ
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MachineModel, MachineNode } from "./model";
import type { DependencyIndex } from "./dependency-index";

export type ResourceRole =
  | "PROVIDES_CAPABILITY" | "USED_BY_CAPABILITY" | "RUNTIME_DEPENDENCY"
  | "DEVELOPMENT_TOOL" | "OPTIONAL_RESOURCE" | "OBSERVED_ONLY";

export type Necessity =
  | "REQUIRED" | "REPLACEABLE" | "OPTIONAL" | "DEVELOPMENT_ONLY"
  | "HISTORICAL" | "UNUSED" | "INSUFFICIENT_EVIDENCE";

/** ชนิดเส้นที่ทำให้ของหนึ่งชิ้น "ให้บริการ" ความสามารถ */
const PROVIDER_EDGE_KINDS = new Set(["MODULE_TO_CAPABILITY", "OWNED_BY_CAPABILITY", "RUNTIME_SERVES_CAPABILITY", "CONNECTION_SERVES_CAPABILITY"]);
/** ชนิดเส้นที่บอกได้แค่ว่าของชิ้นนี้อยู่บนเครื่อง — ไม่บอกว่ามันถูกใช้ */
const EXISTENCE_ONLY_EDGE_KINDS = new Set(["SOFTWARE_RUNS_ON_MACHINE", "OBSERVED_ON_MACHINE"]);

export interface ResourceRoleResult {
  readonly node_id: string;
  readonly roles: readonly ResourceRole[];
  readonly provides: readonly string[];
  readonly used_by: readonly string[];
  readonly depends_on: readonly string[];
  readonly evidence_refs: readonly string[];
}

/** ของชิ้นนี้ให้บริการความสามารถอะไร / ถูกอะไรใช้ / พึ่งอะไร */
export function resolveResourceRoles(nodeId: string, model: MachineModel, index: DependencyIndex): ResourceRoleResult {
  const provides: string[] = [];
  const evidence: string[] = [];
  for (const e of model.edges) {
    if (e.from !== nodeId || !PROVIDER_EDGE_KINDS.has(e.kind)) continue;
    provides.push(e.to);
    evidence.push(`${e.kind}:${e.source_ref}`);
  }
  const dependents = index.dependentsOf(nodeId);
  const dependencies = index.dependenciesOf(nodeId);
  const usedBy = dependents.filter((d) => d.dependent.startsWith("machine://CAPABILITIES/")).map((d) => d.dependent);

  const roles: ResourceRole[] = [];
  if (provides.length > 0) roles.push("PROVIDES_CAPABILITY");
  if (usedBy.length > 0) roles.push("USED_BY_CAPABILITY");
  if (dependents.some((d) => d.kind === "INSTANCE_OF_ENGINE")) roles.push("RUNTIME_DEPENDENCY");
  // OBSERVED_ONLY = รู้แค่ว่ามันอยู่บนเครื่อง ไม่มีความสัมพันธ์เชิงหน้าที่ใดเลย
  if (roles.length === 0
      && model.edges.some((e) => (e.from === nodeId || e.to === nodeId) && EXISTENCE_ONLY_EDGE_KINDS.has(e.kind))) {
    roles.push("OBSERVED_ONLY");
  }
  // DEVELOPMENT_TOOL / OPTIONAL_RESOURCE ต้องมีคำประกาศ — ไม่มีใครประกาศ จึงไม่ถูกกำหนดให้
  return { node_id: nodeId, roles, provides, used_by: usedBy,
    depends_on: dependencies.map((d) => d.depends_on), evidence_refs: evidence };
}

// ─────────────────────────── PHASE 2 — เพราะอะไรถึงใช้ ───────────────────────────

export interface PurposePath {
  readonly resource_id: string;
  /** ที่มาของเจตนา — เป็นข้อความที่ทะเบียนบันทึกไว้ ไม่ใช่ข้อความที่แต่งขึ้น */
  readonly purpose_basis: string | null;
  readonly capability_id: string | null;
  readonly relationship_path: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly status: "PROVEN" | "NO_CAPABILITY_RELATION";
}

/** ทำไมถึงมีของชิ้นนี้ — ตอบเป็นเส้นทางหลักฐาน ไม่ใช่คำบรรยาย */
export function whyResource(nodeId: string, model: MachineModel, index: DependencyIndex): PurposePath {
  const roles = resolveResourceRoles(nodeId, model, index);
  const capNode = roles.provides[0] ?? roles.used_by[0] ?? null;
  if (capNode === null) {
    return { resource_id: nodeId, purpose_basis: null, capability_id: null, relationship_path: [],
      evidence_refs: [], status: "NO_CAPABILITY_RELATION" };
  }
  const cap = model.nodes.find((n) => n.node_id === capNode) ?? null;
  return {
    resource_id: nodeId,
    // เจตนามาจากช่อง purpose ที่ทะเบียนเก็บไว้ตอนลงทะเบียน
    purpose_basis: cap?.purpose ?? null,
    capability_id: capNode.replace("machine://CAPABILITIES/", ""),
    relationship_path: [nodeId, capNode],
    evidence_refs: [...roles.evidence_refs, ...(cap === null ? [] : [`capabilities:${cap.source_ref}`])],
    status: cap?.purpose != null ? "PROVEN" : "NO_CAPABILITY_RELATION",
  };
}

// ─────────────────────────── PHASE 3 — จำเป็นจริงไหม ───────────────────────────

/**
 * ชั้นที่ถือว่าเป็น "ทรัพยากรที่ควบคุม/ใช้งานได้"
 *
 * ค่า CPU หนึ่งค่า หรือเหตุการณ์สังเกตหนึ่งใบ ไม่ใช่ทรัพยากรที่ถามได้ว่าจำเป็น
 * ไหม มันคือข้อเท็จจริงเกี่ยวกับเครื่อง การเอาไปนับรวมจะทำให้ตัวเลข
 * INSUFFICIENT_EVIDENCE บวมด้วยของที่ไม่เคยเป็นคำถามตั้งแต่แรก
 */
export const RESOURCE_LAYERS: ReadonlySet<string> = new Set([
  "FILES_PACKAGES", "REPOSITORIES", "RUNTIME", "LOCAL_DATABASES", "INSTALLED_SOFTWARE",
  "CONNECTED_EXTERNAL_RESOURCES", "CREDENTIAL_POINTERS", "CAPABILITIES", "PROCESSES_SERVICES",
]);

export interface NecessityResult {
  readonly node_id: string;
  readonly layer_id: string;
  readonly necessity: Necessity;
  readonly roles: readonly ResourceRole[];
  readonly dependent_capabilities: readonly string[];
  readonly alternatives: readonly string[];
  readonly reason: string;
  readonly missing_fact_type: string | null;
  readonly evidence_refs: readonly string[];
  /** ทรัพยากรที่ถามได้ว่าจำเป็นไหม — ต่างจากข้อเท็จจริงของเครื่อง */
  readonly is_resource: boolean;
}

const REMOVED_STORE = "software/registry-database/data/canonical/relationships_removed.jsonl";

function historicalIds(): ReadonlySet<string> {
  const path = join(process.cwd(), REMOVED_STORE);
  const out = new Set<string>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (s.length === 0) continue;
    try {
      const r = JSON.parse(s) as Record<string, unknown>;
      if (typeof r.from_id === "string") out.add(r.from_id);
      if (typeof r.to_id === "string") out.add(r.to_id);
    } catch { /* แถวเสียไม่ลบประวัติของแถวอื่น */ }
  }
  return out;
}

/**
 * ตัดสินความจำเป็นของทุกโหนดจากกราฟล้วน ๆ
 *
 * ผู้ให้บริการทางเลือกคือโหนดอื่นที่ประกาศว่าให้บริการความสามารถเดียวกัน —
 * "สัญญาเดียวกัน" ในระบบนี้ถูกแทนด้วยความสามารถที่ถูกผูกไว้ เพราะสัญญา
 * (input/output_contract) เป็นคุณสมบัติของความสามารถนั้นอยู่แล้ว
 */
export function evaluateNecessity(model: MachineModel, index: DependencyIndex): readonly NecessityResult[] {
  const removed = historicalIds();
  // ผู้ให้บริการของแต่ละความสามารถ — ใช้ตัดสินว่ามีทางเลือกอื่นไหม
  const providersOf = new Map<string, string[]>();
  for (const e of model.edges) {
    if (!PROVIDER_EDGE_KINDS.has(e.kind)) continue;
    const list = providersOf.get(e.to) ?? [];
    list.push(e.from);
    providersOf.set(e.to, list);
  }

  const results: NecessityResult[] = [];
  for (const node of model.nodes as readonly MachineNode[]) {
    if (node.layer_id === "MACHINE") continue;
    const roles = resolveResourceRoles(node.node_id, model, index);
    const bareId = node.node_id.split("/").pop() ?? node.node_id;
    const isHistorical = removed.has(bareId) || [...removed].some((r) => node.node_id.endsWith(r));

    const dependentCaps = roles.used_by;
    const alternatives = [...new Set(roles.provides.flatMap((cap) =>
      (providersOf.get(cap) ?? []).filter((p) => p !== node.node_id)))];

    let necessity: Necessity;
    let reason: string;
    let missing: string | null = null;

    if (isHistorical) {
      necessity = "HISTORICAL";
      reason = "ปรากฏในความสัมพันธ์ที่ถูกถอนแล้ว — เก็บไว้เป็นสายเลือด ไม่ใช่ของที่ใช้อยู่";
    } else if (roles.provides.length === 0 && dependentCaps.length === 0) {
      const onlyExistence = model.edges
        .filter((e) => e.from === node.node_id || e.to === node.node_id)
        .every((e) => EXISTENCE_ONLY_EDGE_KINDS.has(e.kind));
      if (onlyExistence) {
        necessity = "INSUFFICIENT_EVIDENCE";
        reason = "รู้แค่ว่ามันอยู่บนเครื่อง ไม่มีใครประกาศความสัมพันธ์เชิงหน้าที่ให้เลย";
        missing = "RESOURCE_TO_CAPABILITY_RELATION";
      } else {
        necessity = "UNUSED";
        reason = "มีตัวตนในทะเบียนแต่ไม่มีเส้นทางพึ่งพาใดเดินมาถึง — ไม่ได้แปลว่าลบได้";
        // ความสามารถถูกเรียกใช้จริงผ่านตัวจัดเส้นทางคำสั่ง ซึ่งยังไม่มีใครประกาศ
        // เป็นความสัมพันธ์ในทะเบียน "ไม่มีเส้นเดินมาถึง" จึงยังไม่เท่ากับ "ไม่มีใครเรียก"
        if (node.layer_id === "CAPABILITIES") missing = "CAPABILITY_INVOCATION_DECLARATION";
      }
    } else if (roles.provides.length > 0 && alternatives.length === 0) {
      necessity = "REQUIRED";
      reason = `เป็นผู้ให้บริการรายเดียวที่ประกาศไว้ของ ${roles.provides.length} ความสามารถ`;
    } else if (roles.provides.length > 0) {
      necessity = "REPLACEABLE";
      reason = `มีผู้ให้บริการอื่นที่ประกาศว่าทำสัญญาเดียวกันได้ ${alternatives.length} ราย`;
    } else {
      necessity = "REQUIRED";
      reason = `มี ${dependentCaps.length} ความสามารถพึ่งมันอยู่ และยังไม่มีของอื่นประกาศทดแทน`;
    }

    results.push({ node_id: node.node_id, layer_id: node.layer_id, necessity, roles: roles.roles,
      dependent_capabilities: dependentCaps, alternatives, reason, missing_fact_type: missing,
      evidence_refs: roles.evidence_refs.length > 0 ? roles.evidence_refs : [node.source_ref],
      is_resource: RESOURCE_LAYERS.has(node.layer_id) });
  }
  return results;
}

// ─────────────────────── PHASE 4 — ถ้าของชิ้นนี้หายไป ───────────────────────

export interface RemovalImpact {
  readonly resource_id: string;
  readonly directly_affected: readonly string[];
  readonly transitively_affected: readonly string[];
  readonly lost_capabilities: readonly string[];
  readonly lost_owner_outcomes: readonly string[];
  readonly available_replacements: readonly string[];
  readonly unresolved_dependency_semantics: number;
  readonly evidence: readonly string[];
}

/** ถ้าของชิ้นนี้หายไป อะไรพังบ้าง — เดินเฉพาะเส้นที่ประกาศความหมายแล้ว */
export function whatIfRemoved(resourceIds: readonly string[], model: MachineModel, index: DependencyIndex): RemovalImpact {
  const removedSet = new Set(resourceIds);
  const direct = new Set<string>();
  const transitive = new Set<string>();
  for (const id of resourceIds) {
    for (const d of index.dependentsOf(id)) direct.add(d.dependent);
    for (const p of index.impactOf(id)) if (p.depth > 1) transitive.add(p.node_id);
  }
  for (const d of direct) transitive.delete(d);

  const providersOf = new Map<string, string[]>();
  for (const e of model.edges) {
    if (!PROVIDER_EDGE_KINDS.has(e.kind)) continue;
    const list = providersOf.get(e.to) ?? [];
    list.push(e.from);
    providersOf.set(e.to, list);
  }

  // ความสามารถจะหายไปก็ต่อเมื่อผู้ให้บริการที่เหลือเป็นศูนย์
  const lost: string[] = [];
  const replacements: string[] = [];
  for (const [cap, providers] of providersOf) {
    const surviving = providers.filter((p) => !removedSet.has(p));
    if (providers.some((p) => removedSet.has(p))) {
      if (surviving.length === 0) lost.push(cap);
      else replacements.push(...surviving);
    }
  }

  return {
    resource_id: resourceIds.join(","),
    directly_affected: [...direct],
    transitively_affected: [...transitive],
    lost_capabilities: lost,
    // ผลลัพธ์ที่ Owner ต้องการ ผูกกับความสามารถที่ประกาศไว้เท่านั้น
    lost_owner_outcomes: lost.length > 0 ? ["outcome:owner-requested-operation-result"] : [],
    available_replacements: [...new Set(replacements)],
    unresolved_dependency_semantics: index.undeclared_edge_count,
    evidence: resourceIds.map((id) => `node:${id}`),
  };
}

// ───────────────── PHASE 5/6 — ชุดที่ประกาศไว้ ไม่ใช่ชุดที่ตั้งชื่อเอง ─────────────────

export interface CounterfactualSet {
  readonly question: string;
  /** เกณฑ์คัดเลือกเป็น "คลาสที่ประกาศไว้ในข้อมูล" ไม่ใช่รายชื่อยี่ห้อ */
  readonly selector: string;
  readonly members: readonly string[];
  readonly status: "HAS_DECLARED_MEMBERS" | "NO_DECLARED_MEMBERS";
  readonly missing_fact_type: string | null;
}

const CONNECTIONS_STORE = "connections/connection-registry/data/connections.jsonl";
const CREDENTIALS_STORE = "credentials/registry/data/api-credential-references.jsonl";

function readRows(rel: string): readonly Record<string, any>[] {
  const path = join(process.cwd(), rel);
  if (!existsSync(path)) return [];
  const out: Record<string, any>[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (s.length === 0) continue;
    try { out.push(JSON.parse(s)); } catch { /* แถวเสียข้ามไป */ }
  }
  return out;
}

/**
 * ชุดสำหรับคำถาม "ถ้าไม่มี X แล้วเหลืออะไร"
 *
 * สมาชิกของชุดถูกเลือกจากคลาสที่ข้อมูลประกาศไว้เอง (`connection_type`, `scope`)
 * ไม่ใช่จากชื่อผู้ให้บริการ ถ้าไม่มีคลาสใดประกาศไว้สำหรับคำถามนั้น คำตอบคือ
 * `NO_DECLARED_MEMBERS` พร้อมชื่อข้อเท็จจริงที่ขาด — ไม่ใช่การไปไล่จับชื่อยี่ห้อ
 */
export function counterfactualSets(model: MachineModel): readonly CounterfactualSet[] {
  const connections = readRows(CONNECTIONS_STORE);
  const credentials = readRows(CREDENTIALS_STORE);

  const byConnectionType = (type: string): string[] => connections
    .filter((c) => c.connection_type === type)
    .map((c) => `machine://CONNECTED_EXTERNAL_RESOURCES/${c.connection_id}`)
    .filter((id) => model.nodes.some((n) => n.node_id === id));

  const byScope = (scopes: readonly string[]): string[] => credentials
    .filter((c) => Array.isArray(c.scope) && c.scope.some((s: string) => scopes.includes(s)))
    .map((c) => `machine://CREDENTIAL_POINTERS/${c.credential_ref}`)
    .filter((id) => model.nodes.some((n) => n.node_id === id));

  const gitMembers = [...byConnectionType("SOURCE_AUTHORITY"), ...byScope(["WRITE_SOURCE", "repo"])];
  const cloudMembers = byScope(["READ_PROJECT_STATUS", "INVOKE_EDGE_FUNCTION", "workflow.read", "workflow.write"]);

  return [
    { question: "WHAT_CAN_DNA_OS_DO_WITHOUT_AI",
      selector: "ทรัพยากรที่ประกาศคลาสว่าให้บริการเชิงโมเดลภาษา",
      members: [], status: "NO_DECLARED_MEMBERS",
      missing_fact_type: "AI_RESOURCE_CLASS_DECLARATION" },
    { question: "WHAT_CAN_DNA_OS_DO_WITHOUT_IDE",
      selector: "ทรัพยากรที่ประกาศคลาสว่าเป็นเครื่องมือพัฒนา",
      members: [], status: "NO_DECLARED_MEMBERS",
      missing_fact_type: "DEVELOPMENT_TOOL_CLASS_DECLARATION" },
    { question: "WHAT_CAN_DNA_OS_DO_WITHOUT_REMOTE_GIT_HOST",
      selector: "connection_type=SOURCE_AUTHORITY หรือ scope ที่ประกาศสิทธิ์เขียนซอร์ส",
      members: gitMembers,
      status: gitMembers.length > 0 ? "HAS_DECLARED_MEMBERS" : "NO_DECLARED_MEMBERS",
      missing_fact_type: gitMembers.length > 0 ? null : "SOURCE_AUTHORITY_CONNECTION_DECLARATION" },
    { question: "WHAT_CAN_DNA_OS_DO_WITHOUT_EXTERNAL_CLOUD_RUNTIME",
      selector: "scope ที่ประกาศการเรียกใช้บริการนอกเครื่อง",
      members: cloudMembers,
      status: cloudMembers.length > 0 ? "HAS_DECLARED_MEMBERS" : "NO_DECLARED_MEMBERS",
      missing_fact_type: cloudMembers.length > 0 ? null : "EXTERNAL_RUNTIME_CLASS_DECLARATION" },
  ];
}

/**
 * ตรวจว่าไม่มีความจำเป็นใดผูกกับตัวของมันเองโดยไม่มีความสัมพันธ์รองรับ
 *
 * ── เส้นแบ่งอยู่ตรงไหน ──
 * บริการหนึ่งตัวเป็น `REQUIRED` ได้ ถ้ามีความสามารถ "ประกาศไว้" ว่ารันอยู่ในนั้น
 * — ความจำเป็นจบที่คำประกาศ ไม่ใช่ที่ชื่อ แต่ถ้าของชิ้นหนึ่งถูกตัดสินว่าจำเป็น
 * ทั้งที่รู้แค่ว่ามันอยู่บนเครื่อง (`OBSERVED_ONLY` หรือไม่มีบทบาทเลย) นั่นคือ
 * ความจำเป็นที่มาจากการมีอยู่ ซึ่งเป็นสิ่งที่ห้าม
 */
export function neutralityViolations(results: readonly NecessityResult[]): readonly string[] {
  return results
    .filter((r) => r.necessity === "REQUIRED")
    .filter((r) => r.roles.length === 0 || r.roles.includes("OBSERVED_ONLY"))
    .map((r) => r.node_id);
}
