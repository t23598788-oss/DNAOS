/**
 * หน้าที่: ตรวจว่าแผนที่วางไว้ต่อกันได้จริงไหม แล้วสร้าง EXECUTION_MANIFEST
 *
 * Owner, 2026-09-05 ข้อ 22/23: linker ต้องไม่มีการเรียกโมเดลภาษา และผลต้องเป็น
 * หนึ่งใน LINKABLE | ADAPTER_REQUIRED | BLOCKED | INVALID เท่านั้น
 * manifest ที่ออกมาเป็น "ข้อมูล" ยังไม่ execute อะไรกับ production
 *
 * Dependency ที่อนุญาต: ./registry.ts ./planner.ts ./port-compatibility.ts ./types.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเรียก entrypoint จริงจากไฟล์นี้
 * - ห้ามลดผลจาก BLOCKED เป็น LINKABLE เพราะ "น่าจะได้"
 */

import { checkPortCompatibility } from "./port-compatibility";
import { portById, unitById } from "./registry";
import type { AssemblyPlan, PlanContext } from "./planner";
import type { PortContract, TraceContext } from "./types";

export type LinkVerdict = "LINKABLE" | "ADAPTER_REQUIRED" | "BLOCKED" | "INVALID";

export interface LinkEdge {
  readonly producer_unit: string;
  readonly producer_port: string;
  readonly consumer_unit: string;
  readonly consumer_port: string;
  readonly verdict: string;
  readonly blocking: readonly string[];
}

export interface LinkResult {
  readonly schema: "LINK_RESULT_V1";
  readonly verdict: LinkVerdict;
  readonly edges: readonly LinkEdge[];
  readonly problems: readonly string[];
  readonly llm_calls: 0;
}

function findCycle(edges: readonly { from: string; to: string }[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of edges) { if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from)!.push(e.to); }
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  let cycle: string[] | null = null;
  const walk = (n: string): void => {
    if (cycle !== null) return;
    state.set(n, 1); stack.push(n);
    for (const m of adj.get(n) ?? []) {
      if (state.get(m) === 1) { cycle = [...stack.slice(stack.indexOf(m)), m]; return; }
      if (state.get(m) === undefined) walk(m);
    }
    state.set(n, 2); stack.pop();
  };
  for (const n of adj.keys()) if (state.get(n) === undefined) walk(n);
  return cycle;
}

export function link(plan: AssemblyPlan, context: PlanContext): LinkResult {
  const problems: string[] = [];
  const edges: LinkEdge[] = [];

  if (!plan.resolvable) {
    for (const c of plan.missing_capabilities) problems.push(`ไม่มี unit ใดประกาศ capability: ${c}`);
    for (const a of plan.ambiguous_capabilities) problems.push(`capability กำกวม ${a.capability}: ${a.candidates.join(", ")}`);
    for (const u of plan.unavailable_units) problems.push(`unit ใช้งานไม่ได้: ${u.unit_id} (${u.availability})`);
    for (const r of plan.unmet_resources) problems.push(`ทรัพยากรไม่พร้อม: ${r}`);
    for (const a of plan.unmet_authority) problems.push(`สิทธิ์ไม่พอ: ${a}`);
  }

  // unit ที่ reusable แต่ไม่มี entrypoint = ประกอบไม่ได้จริง (ข้อ 1)
  for (const n of plan.nodes) {
    if (n.entrypoint_ref === null) problems.push(`unit ไม่มี entrypoint: ${n.unit_id}`);
    if (n.ports_in.length === 0 && n.ports_out.length === 0) problems.push(`unit ไม่มี port: ${n.unit_id}`);
  }

  const cycle = findCycle(plan.edges);
  if (cycle !== null) problems.push(`พบวงจรพึ่งพา: ${cycle.join(" -> ")}`);

  // ต่อ port ตามเส้น edge ของแผน: ผู้ให้ capability เป็นผู้ผลิต ผู้ขอเป็นผู้บริโภค
  let needsAdapter = false;
  for (const e of plan.edges) {
    const producer = unitById(e.from);
    const consumer = unitById(e.to);
    if (producer === null || consumer === null) { problems.push(`หา unit ไม่เจอสำหรับเส้น ${e.from} -> ${e.to}`); continue; }
    const outs = producer.ports_out.map(portById).filter((p): p is PortContract => p !== null);
    const ins = consumer.ports_in.map(portById).filter((p): p is PortContract => p !== null);
    if (outs.length === 0) { problems.push(`${producer.unit_id} ไม่มี port ขาออกให้ต่อ`); continue; }
    if (ins.length === 0) { problems.push(`${consumer.unit_id} ไม่มี port ขาเข้าให้รับ`); continue; }

    /**
     * ผู้บริโภคประกาศไว้ว่ารับ schema อะไรจาก capability นี้ ให้เทียบกับสิ่งนั้น
     * ไม่ใช่กับ input ทั้งก้อนของมัน — dependency ป้อนแค่ชิ้นส่วน
     */
    const expected = consumer.dependency_inputs?.[e.capability] ?? null;
    const targets: PortContract[] = expected === null ? ins
      : ins.map((i) => ({ ...i, input_schema_ref: expected }));

    // เลือกคู่ที่ดีที่สุดที่หาได้ ไม่ใช่คู่แรกที่เจอ
    let best: { r: ReturnType<typeof checkPortCompatibility>; o: PortContract; i: PortContract } | null = null;
    const rank = { COMPATIBLE: 0, ADAPTER_REQUIRED: 1, UNKNOWN: 2, INCOMPATIBLE: 3 } as const;
    for (const o of outs) for (const i of targets) {
      const r = checkPortCompatibility(o, i, {
        availableResources: context.available_resources, grantedAuthority: context.granted_authority,
      });
      if (best === null || rank[r.verdict] < rank[best.r.verdict]) best = { r, o, i };
    }
    if (best === null) continue;
    edges.push({
      producer_unit: producer.unit_id, producer_port: best.o.port_id,
      consumer_unit: consumer.unit_id, consumer_port: best.i.port_id,
      verdict: best.r.verdict, blocking: best.r.blocking,
    });
    if (best.r.verdict === "ADAPTER_REQUIRED") needsAdapter = true;
    if (best.r.verdict === "INCOMPATIBLE") problems.push(`ต่อไม่ได้ ${best.o.port_id} -> ${best.i.port_id}: ${best.r.blocking.join(" · ")}`);
    if (best.r.verdict === "UNKNOWN") problems.push(`ตัดสินไม่ได้ ${best.o.port_id} -> ${best.i.port_id}: ${best.r.blocking.join(" · ")}`);
  }

  const structural = plan.nodes.length === 0;
  const verdict: LinkVerdict = structural ? "INVALID"
    : problems.length > 0 ? "BLOCKED"
    : needsAdapter ? "ADAPTER_REQUIRED"
    : "LINKABLE";

  return { schema: "LINK_RESULT_V1", verdict, edges, problems, llm_calls: 0 };
}

// ─── §23 EXECUTION_MANIFEST_V1 ──────────────────────────────────────────────

export interface ExecutionOperation {
  readonly order: number;
  readonly unit_id: string;
  readonly entrypoint_ref: string;
  readonly input_binding: string | null;
  readonly output_binding: string | null;
  readonly authority_required: readonly string[];
  readonly resource_binding: readonly string[];
  readonly side_effects: readonly string[];
  readonly verification: string | null;
  readonly failure_behavior: string;
}

export interface ExecutionManifestV1 {
  readonly schema: "EXECUTION_MANIFEST_V1";
  readonly manifest_id: string;
  readonly requested_capabilities: readonly string[];
  readonly ordered_operations: readonly ExecutionOperation[];
  readonly bindings: readonly LinkEdge[];
  readonly trace_template: Omit<TraceContext, "trace_id" | "stage_id">;
  readonly rollback_behavior: string;
  readonly executed: false;
  readonly llm_calls: 0;
}

export function buildExecutionManifest(
  plan: AssemblyPlan, linkResult: LinkResult, manifestId: string,
): { ok: true; manifest: ExecutionManifestV1 } | { ok: false; reason_code: string; problems: readonly string[] } {
  if (linkResult.verdict !== "LINKABLE") {
    return { ok: false, reason_code: `NOT_LINKABLE_${linkResult.verdict}`, problems: linkResult.problems };
  }
  // แผนถูกจัดเรียงจาก depth มากไปน้อยแล้ว — ตัวที่ลึกที่สุดคือ dependency ที่ต้องทำก่อน
  const ops: ExecutionOperation[] = plan.nodes.map((n, idx) => {
    const u = unitById(n.unit_id)!;
    const inPort = n.ports_in[0] ? portById(n.ports_in[0]) : null;
    const outPort = n.ports_out[0] ? portById(n.ports_out[0]) : null;
    return {
      order: idx + 1, unit_id: n.unit_id, entrypoint_ref: n.entrypoint_ref!,
      input_binding: inPort?.input_schema_ref ?? null,
      output_binding: outPort?.output_schema_ref ?? null,
      authority_required: u.authority_requirements,
      resource_binding: u.resource_requirements,
      side_effects: u.side_effects,
      verification: u.verification_profile,
      failure_behavior: u.failure_modes[0] ?? "ไม่ได้ประกาศไว้",
    };
  });
  return { ok: true, manifest: {
    schema: "EXECUTION_MANIFEST_V1", manifest_id: manifestId,
    requested_capabilities: plan.requested_capabilities,
    ordered_operations: ops, bindings: linkResult.edges,
    trace_template: { flow_id: manifestId, work_id: null, command_id: null, business_entity_id: null, parent_stage_id: null },
    rollback_behavior: "ยังไม่มีการย้อนกลับอัตโนมัติ — ทุก operation ที่มีผลข้างเคียงต้องย้อนด้วยคำสั่งของตัวเอง",
    executed: false, llm_calls: 0,
  } };
}
