/**
 * หน้าที่: ตอบว่าความสามารถแต่ละตัวถูกเรียกใช้อย่างไร ใครเรียก ผ่านสัญญาอะไร
 *         และอะไรเป็นตัวรัน โดยอ่านจากคำประกาศที่มีอยู่แล้วและจากหลักฐานการรันจริง
 *
 * ── คำประกาศที่มีอยู่แล้ว แต่ไม่เคยถูกฉายลงกราฟ ──
 * `connection.executor_capability_id` เคยเป็นแบบนี้: ข้อมูลถูกเขียนไว้ตั้งแต่แรก
 * แต่ไม่มีใครแปลงเป็นเส้น กราฟจึงตอบว่า "ไม่มีอะไรเกี่ยวข้องกัน" ทั้งที่ความจริง
 * ถูกประกาศไว้แล้ว ไฟล์นี้ไล่หาแบบเดียวกันในทะเบียนที่เหลือ: ตัวจัดเส้นทางคำสั่ง
 * ตารางผู้ปฏิบัติของ route ตารางบริการของ runtime-control และเป้าหมายการสังเกต
 *
 * ── ประกาศไว้ กับ เห็นว่ารันจริง ไม่ใช่สิ่งเดียวกัน ──
 * `DECLARED` มาจากทะเบียน/สัญญา `OBSERVED` มาจากหลักฐานการรันที่บันทึกไว้แล้ว
 * ทั้งสองไม่ถูกแปลงเป็นกันและกัน มีทั้งคู่จึงเป็น `CONFIRMED` มีแต่คำประกาศคือ
 * `DECLARED_NOT_OBSERVED` และเห็นว่ารันโดยไม่มีใครประกาศคือ `OBSERVED_UNDECLARED`
 * ซึ่งเป็นช่องว่างของโมเดล ไม่ใช่ใบอนุญาตให้เขียนลงทะเบียนเอง
 *
 * ── ทิศของการเรียก ไม่ใช่ทิศของการพึ่งพา ──
 * ผู้เรียกพึ่งผู้ถูกเรียก แต่ความสามารถที่รันอยู่ในบริการหนึ่ง พึ่งบริการนั้น
 * ทั้งที่ลูกศรการเรียกชี้คนละทาง ทุกชนิดเส้นจึงประกาศความหมายเชิงพึ่งพาแยกต่างหาก
 * ใน `EDGE_SEMANTICS` เสมอ
 *
 * ── ห้ามตีความจากชื่อ ──
 * การจับคู่ทุกครั้งใช้ช่องที่ระบบเขียนไว้เอง (`capability_id`, `canonical_name`,
 * `launchd_label`, `source`) ไม่มีที่ใดเดาจากชื่อไฟล์ ชื่อโฟลเดอร์ ชื่อแอป
 * หรือชื่อผู้ให้บริการ
 *
 * Input: `MachineModel`
 * Output: `projectInvocations`, `invocationOfCapability`, `resolveInvocationGaps`
 * Dependency ที่อนุญาต: command-router, owner-backbone, runtime-control, agent-gateway (อ่าน)
 * สิ่งที่ห้ามแตะ: ห้ามเขียนทะเบียน ห้ามสั่งรัน ห้ามเปิดการเรียกอัตโนมัติ
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listCapabilities } from "../command-router/contract";
import { EXECUTOR_BINDINGS } from "../owner-backbone/route-dispatch";
import { SERVICES } from "../runtime-control/contract";
import { resolveOwnershipForPath } from "../owner-error-lane/contract";
import type { MachineModel } from "./model";

export type InvocationKind =
  | "CAPABILITY_INVOKED_BY_ROUTE"
  | "CAPABILITY_INVOKED_BY_CAPABILITY"
  | "CAPABILITY_EXPOSED_THROUGH_CONTRACT"
  | "CAPABILITY_DISPATCHED_TO_EXECUTOR"
  | "CAPABILITY_RUNS_IN_PROCESS"
  | "CAPABILITY_EXECUTED_BY_RUNTIME";

export type InvocationStatus = "CONFIRMED_INVOCATION" | "DECLARED_NOT_OBSERVED" | "OBSERVED_UNDECLARED";

export interface DeclaredInvocation {
  readonly capability_id: string;
  readonly kind: InvocationKind;
  readonly entry_boundary: string | null;
  readonly caller: string | null;
  readonly contract: string | null;
  readonly route: string | null;
  readonly dispatch_boundary: string | null;
  readonly executor: string | null;
  readonly runtime_resource: string | null;
  readonly process_service: string | null;
  readonly evidence_ref: string;
}

export interface ObservedInvocation {
  readonly capability_id: string;
  readonly executing_component: string;
  readonly occurrence_count: number;
  readonly last_observed_at: string;
  readonly evidence_ref: string;
}

const CANONICAL_CAPABILITIES = "software/registry-database/data/canonical/capabilities.jsonl";
const GATEWAY_EVIDENCE = "control/agent-gateway/data/evidence.jsonl";
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

/** ชื่อ canonical -> capability_id ของทะเบียน (ช่องที่ทะเบียนเขียนไว้เอง) */
function canonicalNameIndex(): ReadonlyMap<string, string> {
  const m = new Map<string, string>();
  for (const c of readJsonl(CANONICAL_CAPABILITIES)) {
    if (typeof c.canonical_name === "string" && typeof c.capability_id === "string") {
      m.set(c.canonical_name, c.capability_id);
    }
  }
  return m;
}

/**
 * ผูกแถวของตัวจัดเส้นทางเข้ากับความสามารถ ผ่าน path ที่แถวนั้นประกาศไว้
 *
 * ใช้เฉพาะช่อง `contract` และ `endpoint.module` ซึ่งเป็นการอ้างอิงที่ผู้เขียนแถว
 * ใส่ไว้เอง ผลที่ไม่ใช่ `capability-*` ของทะเบียน canonical จะถูกทิ้ง — ไม่มีการ
 * จับคู่แบบใกล้เคียงและไม่มีการเดาจากชื่อ
 */
function capabilityByDeclaredPath(reg: Record<string, any>): string | undefined {
  const endpoint = (reg.endpoint ?? {}) as Record<string, unknown>;
  for (const ref of [reg.contract, endpoint.module]) {
    if (typeof ref !== "string" || !ref.includes("/")) continue;
    const owned = resolveOwnershipForPath(ref);
    if (owned.capability_id !== null && owned.capability_id.startsWith("capability-")) return owned.capability_id;
  }
  return undefined;
}

let declaredCache: readonly DeclaredInvocation[] | null = null;

/**
 * ฉายคำประกาศที่มีอยู่แล้วออกมาเป็นความสัมพันธ์การเรียกใช้
 *
 * ไม่มีการเก็บลงคลังใหม่ — เป็นการอ่านช่องที่ถูกเขียนไว้แล้วในทะเบียนสี่แห่ง
 * แล้วต่อกันด้วยตัวตนที่ทะเบียนประกาศเอง
 */
export function projectDeclaredInvocations(): readonly DeclaredInvocation[] {
  if (declaredCache !== null) return declaredCache;
  const byName = canonicalNameIndex();
  const out: DeclaredInvocation[] = [];

  // 1) ตัวจัดเส้นทางคำสั่ง: route + สัญญา + จุดเข้า
  const routerCapability = byName.get("command-router") ?? null;
  for (const reg of listCapabilities() as unknown as readonly Record<string, any>[]) {
    // ── ผูกด้วยชื่อ canonical ก่อน แล้วจึงด้วย path ที่แถวนั้นประกาศไว้เอง ──
    // แถวของตัวจัดเส้นทางใช้ชื่อเรียกของมันเอง ("permission-reasoner") ซึ่งไม่ใช่
    // ชื่อ canonical ของทะเบียน แต่มันประกาศ `contract` และ `endpoint.module`
    // เป็น path จริงไว้ด้วย การถามทะเบียนว่าใครเป็นเจ้าของ path นั้นคือการอ่าน
    // การอ้างอิงที่ประกาศไว้ ไม่ใช่การเดาจากชื่อ — path ที่ไม่มีเจ้าของจะไม่ผูก
    const canonical = byName.get(String(reg.capability_id)) ?? capabilityByDeclaredPath(reg);
    if (canonical === undefined) continue;      // ไม่มีตัวตนใน canonical registry = ช่องว่าง ไม่ใช่การเดา
    const endpoint = (reg.endpoint ?? {}) as Record<string, unknown>;
    const entry = typeof endpoint.module === "string"
      ? `${endpoint.module}${typeof endpoint.entry === "string" ? `#${endpoint.entry}` : ""}` : null;
    out.push({
      capability_id: canonical, kind: "CAPABILITY_INVOKED_BY_ROUTE",
      entry_boundary: entry, caller: routerCapability,
      contract: typeof reg.contract === "string" ? reg.contract : null,
      route: Array.isArray(reg.supported_commands) ? reg.supported_commands.join(",") : null,
      dispatch_boundary: "control/command-router",
      // จุดที่ลงมือคือโมดูลที่แถวนั้นประกาศไว้เอง ไม่ใช่ค่าที่อนุมาน
      executor: typeof endpoint.module === "string" ? endpoint.module : null,
      runtime_resource: null, process_service: null,
      evidence_ref: `command-router:capability-registry:${reg.capability_id}`,
    });
    if (entry !== null) {
      out.push({
        capability_id: canonical, kind: "CAPABILITY_EXPOSED_THROUGH_CONTRACT",
        entry_boundary: entry, caller: null,
        contract: typeof reg.contract === "string" ? reg.contract : null,
        route: null, dispatch_boundary: null, executor: null,
        runtime_resource: null, process_service: null,
        evidence_ref: `command-router:endpoint:${reg.capability_id}`,
      });
    }
  }

  // 2) ตารางผู้ปฏิบัติของ route: route_action -> ความสามารถที่ลงมือ
  const dispatcherCapability = byName.get("owner-backbone") ?? null;
  for (const b of EXECUTOR_BINDINGS as unknown as readonly Record<string, any>[]) {
    const canonical = byName.get(String(b.capability_canonical_name));
    if (canonical === undefined) continue;
    out.push({
      capability_id: canonical, kind: "CAPABILITY_DISPATCHED_TO_EXECUTOR",
      entry_boundary: typeof b.target_symbol === "string" ? b.target_symbol : null,
      caller: dispatcherCapability,
      contract: typeof b.input_contract === "string" ? b.input_contract : null,
      route: typeof b.route_action === "string" ? b.route_action : null,
      dispatch_boundary: "control/owner-backbone/route-dispatch",
      executor: typeof b.target_owner === "string" ? b.target_owner : null,
      runtime_resource: null, process_service: null,
      evidence_ref: `owner-backbone:EXECUTOR_BINDINGS:${b.route_action}`,
    });
  }

  // 3) เป้าหมายการสังเกต: ความสามารถ -> บริการ launchd -> พอร์ต
  for (const t of readJsonl(RUNTIME_TARGETS)) {
    const capId = typeof t.capability_id === "string" ? t.capability_id : null;
    const label = (t.process ?? {}).launchd_label ?? null;
    if (capId === null || typeof label !== "string") continue;
    const service = (SERVICES as unknown as Record<string, Record<string, unknown>>)[String(t.canonical_name)] ?? null;
    out.push({
      capability_id: capId, kind: "CAPABILITY_RUNS_IN_PROCESS",
      entry_boundary: (t.health ?? {}).path ?? null, caller: null,
      contract: null, route: null, dispatch_boundary: null,
      executor: null,
      runtime_resource: `machine://RUNTIME/${t.runtime_target_id}`,
      process_service: label,
      evidence_ref: `runtime-targets:${t.runtime_target_id}${service === null ? "" : " + runtime-control:SERVICES"}`,
    });
  }

  declaredCache = out;
  return out;
}

let observedCache: readonly ObservedInvocation[] | null = null;

/**
 * หลักฐานว่าความสามารถไหน "รันจริง" — มาจากช่อง `source` ที่ผู้ผลิตหลักฐานเขียนไว้
 *
 * `source` เป็น path ของโมดูลที่ผลิตแถวนั้น เมื่อถามทะเบียนว่าใครเป็นเจ้าของ path
 * นั้น จะได้ความสามารถที่ทำงานอยู่จริงตอนบันทึก นี่คือการอ่านช่องที่มีอยู่ ไม่ใช่
 * การเดาจากชื่อ — path ที่ทะเบียนไม่รู้จักจะถูกทิ้ง ไม่ถูกจับคู่แบบใกล้เคียง
 */
export function projectObservedInvocations(): readonly ObservedInvocation[] {
  if (observedCache !== null) return observedCache;
  const bySource = new Map<string, { count: number; last: string }>();
  for (const row of readJsonl(GATEWAY_EVIDENCE)) {
    const src = typeof row.source === "string" ? row.source : null;
    const at = typeof row.recorded_at === "string" ? row.recorded_at : null;
    if (src === null || at === null) continue;
    const cur = bySource.get(src);
    if (cur === undefined) bySource.set(src, { count: 1, last: at });
    else { cur.count += 1; if (at > cur.last) cur.last = at; }
  }

  const merged = new Map<string, ObservedInvocation>();
  for (const [src, agg] of bySource) {
    // ตัดส่วน #symbol และคำอธิบายในวงเล็บออก เหลือ path ที่ทะเบียนรู้จัก
    const path = src.split("#")[0].split(" ")[0];
    if (!path.includes("/")) continue;                 // ไม่ใช่ path = ไม่ถามทะเบียน
    const owned = resolveOwnershipForPath(path);
    if (owned.capability_id === null) continue;        // ทะเบียนไม่รู้จัก = ไม่จับคู่
    const prev = merged.get(owned.capability_id);
    if (prev === undefined) {
      merged.set(owned.capability_id, { capability_id: owned.capability_id, executing_component: path,
        occurrence_count: agg.count, last_observed_at: agg.last, evidence_ref: `agent-gateway:evidence.source=${src}` });
    } else {
      merged.set(owned.capability_id, { ...prev,
        occurrence_count: prev.occurrence_count + agg.count,
        last_observed_at: agg.last > prev.last_observed_at ? agg.last : prev.last_observed_at });
    }
  }
  observedCache = [...merged.values()];
  return observedCache;
}

// ─────────────────────────── PHASE 3 — ห่วงโซ่การรัน ───────────────────────────

export interface InvocationChain {
  readonly capability_id: string;
  readonly entry_boundary: readonly string[];
  readonly caller: readonly string[];
  readonly contract: readonly string[];
  readonly route: readonly string[];
  readonly dispatch_boundary: readonly string[];
  readonly executor: readonly string[];
  readonly runtime_resource: readonly string[];
  readonly process_service: readonly string[];
  readonly declared_evidence: readonly string[];
  readonly observed_evidence: readonly string[];
  readonly last_observed_at: string | null;
  readonly status: InvocationStatus | "NO_INVOCATION_EVIDENCE";
}

const uniq = (xs: readonly (string | null)[]): readonly string[] =>
  [...new Set(xs.filter((x): x is string => typeof x === "string" && x.length > 0))];

/** ห่วงโซ่การเรียกใช้ของความสามารถหนึ่งตัว — ช่องที่ไม่รู้ ปล่อยว่างไว้ให้เห็น */
export function invocationOfCapability(capabilityId: string): InvocationChain {
  const declared = projectDeclaredInvocations().filter((d) => d.capability_id === capabilityId);
  const observed = projectObservedInvocations().filter((o) => o.capability_id === capabilityId);
  const status: InvocationChain["status"] =
    declared.length > 0 && observed.length > 0 ? "CONFIRMED_INVOCATION"
    : declared.length > 0 ? "DECLARED_NOT_OBSERVED"
    : observed.length > 0 ? "OBSERVED_UNDECLARED"
    : "NO_INVOCATION_EVIDENCE";
  return {
    capability_id: capabilityId,
    entry_boundary: uniq(declared.map((d) => d.entry_boundary)),
    caller: uniq(declared.map((d) => d.caller)),
    contract: uniq(declared.map((d) => d.contract)),
    route: uniq(declared.map((d) => d.route)),
    dispatch_boundary: uniq(declared.map((d) => d.dispatch_boundary)),
    executor: uniq([...declared.map((d) => d.executor), ...observed.map((o) => o.executing_component)]),
    runtime_resource: uniq(declared.map((d) => d.runtime_resource)),
    process_service: uniq(declared.map((d) => d.process_service)),
    declared_evidence: uniq(declared.map((d) => d.evidence_ref)),
    observed_evidence: uniq(observed.map((o) => o.evidence_ref)),
    last_observed_at: observed.length === 0 ? null
      : observed.map((o) => o.last_observed_at).sort().slice(-1)[0],
    status,
  };
}

// ─────────────────────────── PHASE 6 — คำถาม ───────────────────────────

export const whoInvokes = (capabilityId: string): readonly string[] => invocationOfCapability(capabilityId).caller;
export const howIsInvoked = (capabilityId: string): readonly string[] => {
  const d = projectDeclaredInvocations().filter((x) => x.capability_id === capabilityId);
  return uniq(d.map((x) => `${x.kind}:${x.route ?? x.entry_boundary ?? x.process_service ?? "-"}`));
};
export const whatExecutes = (capabilityId: string): readonly string[] => invocationOfCapability(capabilityId).executor;
export const whereDoesItRun = (capabilityId: string): readonly string[] => {
  const c = invocationOfCapability(capabilityId);
  return uniq([...c.process_service, ...c.runtime_resource]);
};
export const whatContractIsUsed = (capabilityId: string): readonly string[] => invocationOfCapability(capabilityId).contract;
export const lastObservedInvocation = (capabilityId: string): string | null => invocationOfCapability(capabilityId).last_observed_at;

// ─────────────────────── PHASE 4 — ปิดช่องว่าง 80 ใบ ───────────────────────

export interface GapResolution {
  readonly capability_id: string;
  readonly outcome: "RESOLVED" | "PARTIAL" | "STILL_MISSING";
  readonly status: InvocationChain["status"];
  readonly evidence: readonly string[];
  readonly missing_fact_type: string | null;
}

/**
 * ช่องว่างแต่ละใบปิดได้เมื่อมีหลักฐานเท่านั้น
 *
 * `RESOLVED` = ทั้งประกาศไว้และเห็นว่ารันจริง · `PARTIAL` = มีอย่างใดอย่างหนึ่ง
 * · `STILL_MISSING` = ไม่มีเลย และต้องบอกด้วยว่าข้อเท็จจริงชนิดไหนที่ยังขาด
 * ไม่มีทางลดตัวเลขด้วยการสร้างความสัมพันธ์กว้าง ๆ ขึ้นมาแปะ
 */
export function resolveInvocationGaps(capabilityIds: readonly string[]): readonly GapResolution[] {
  return capabilityIds.map((id) => {
    const chain = invocationOfCapability(id);
    if (chain.status === "CONFIRMED_INVOCATION") {
      return { capability_id: id, outcome: "RESOLVED" as const, status: chain.status,
        evidence: [...chain.declared_evidence, ...chain.observed_evidence], missing_fact_type: null };
    }
    if (chain.status === "DECLARED_NOT_OBSERVED") {
      return { capability_id: id, outcome: "PARTIAL" as const, status: chain.status,
        evidence: [...chain.declared_evidence], missing_fact_type: "OBSERVED_EXECUTION_EVIDENCE" };
    }
    if (chain.status === "OBSERVED_UNDECLARED") {
      return { capability_id: id, outcome: "PARTIAL" as const, status: chain.status,
        evidence: [...chain.observed_evidence], missing_fact_type: "DECLARED_INVOCATION_BOUNDARY" };
    }
    return { capability_id: id, outcome: "STILL_MISSING" as const, status: chain.status,
      evidence: [], missing_fact_type: "CAPABILITY_INVOCATION_DECLARATION" };
  });
}

// ─────────────────── PHASE 5 — ฉายลงกราฟ (เฉพาะสองปลายที่มีจริง) ───────────────────

export interface InvocationEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: InvocationKind;
  readonly source_ref: string;
}

/**
 * แปลงคำประกาศเป็นเส้นในกราฟ เฉพาะคู่ที่ทั้งสองปลายเป็นโหนดที่มีอยู่จริง
 *
 * คำประกาศที่ปลายทางยังไม่มีโหนด (เช่น route ที่ไม่ได้เป็นเอนทิตีในโมเดล) จะไม่
 * ถูกสร้างโหนดปลอมขึ้นมารองรับ — มันยังเป็น record ที่ถามได้ แต่ไม่ปลอมเป็นกราฟ
 */
export function projectInvocationEdges(model: MachineModel): readonly InvocationEdge[] {
  const nodeIds = new Set(model.nodes.map((n) => n.node_id));
  const edges: InvocationEdge[] = [];
  const capNode = (id: string): string => `machine://CAPABILITIES/${id}`;

  for (const d of projectDeclaredInvocations()) {
    const to = capNode(d.capability_id);
    if (!nodeIds.has(to)) continue;
    if (d.caller !== null) {
      const from = capNode(d.caller);
      if (nodeIds.has(from) && from !== to) {
        edges.push({ from, to, kind: d.kind === "CAPABILITY_DISPATCHED_TO_EXECUTOR"
          ? "CAPABILITY_DISPATCHED_TO_EXECUTOR" : "CAPABILITY_INVOKED_BY_CAPABILITY", source_ref: d.evidence_ref });
      }
    }
    if (d.process_service !== null) {
      const proc = `machine://INSTALLED_SOFTWARE/BACKGROUND_SERVICE/${d.process_service}`;
      if (nodeIds.has(proc)) {
        edges.push({ from: to, to: proc, kind: "CAPABILITY_RUNS_IN_PROCESS", source_ref: d.evidence_ref });
      }
    }
  }
  return edges;
}
