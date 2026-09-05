/**
 * หน้าที่: วางแผนการประกอบจาก capability ที่ขอ โดยไม่เรียกโมเดลภาษาใด ๆ
 *
 * Owner, 2026-09-05 ข้อ 21/27: ตราบใดที่ capability และ connection ที่ต้องใช้มี
 * อยู่ครบแล้ว การประกอบต้องสำเร็จโดย LLM_CALL_COUNT = 0
 * AI ใช้ได้เฉพาะตอนแปลภาษาคนเป็น command id เท่านั้น ซึ่งอยู่นอกไฟล์นี้
 *
 * Input: capability ที่ต้องการ + บริบท (บริษัท ทรัพยากร สิทธิ์)
 * Output: ASSEMBLY_PLAN
 * Dependency ที่อนุญาต: ./registry.ts ./types.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้าม import อะไรที่เรียกโมเดลภาษา
 * - ห้ามเดา unit เมื่อไม่มีตัวไหนประกาศ capability นั้น ต้องรายงานว่าขาด
 */

import { unitById, units, unitsProviding } from "./registry";
import type { AssemblyUnitV2 } from "./types";

export interface PlanContext {
  readonly company_id?: string;
  readonly available_resources: readonly string[];
  readonly granted_authority: readonly string[];
}

export interface PlanNode {
  readonly unit_id: string;
  readonly capability: string;
  readonly depth: number;
  readonly entrypoint_ref: string | null;
  readonly ports_in: readonly string[];
  readonly ports_out: readonly string[];
}

export interface AssemblyPlan {
  readonly schema: "ASSEMBLY_PLAN_V1";
  readonly requested_capabilities: readonly string[];
  readonly nodes: readonly PlanNode[];
  readonly edges: readonly { from: string; to: string; capability: string }[];
  readonly missing_capabilities: readonly string[];
  readonly ambiguous_capabilities: readonly { capability: string; candidates: readonly string[] }[];
  readonly unavailable_units: readonly { unit_id: string; availability: string }[];
  readonly unmet_resources: readonly string[];
  readonly unmet_authority: readonly string[];
  readonly resolvable: boolean;
  readonly llm_calls: 0;
}

const MAX_DEPTH = 12;

export function planAssembly(requested: readonly string[], context: PlanContext): AssemblyPlan {
  const nodes = new Map<string, PlanNode>();
  const edges: { from: string; to: string; capability: string }[] = [];
  const missing: string[] = [];
  const ambiguous: { capability: string; candidates: string[] }[] = [];
  const seen = new Set<string>();

  const expand = (capability: string, depth: number, parent: string | null): void => {
    if (depth > MAX_DEPTH) return;
    const key = `${capability}@${parent ?? "root"}`;
    if (seen.has(key)) return;
    seen.add(key);

    const candidates = unitsProviding(capability);
    if (candidates.length === 0) { missing.push(capability); return; }
    if (candidates.length > 1) {
      // ต้องมีตัวเลือกเดียวเท่านั้นจึงจะ deterministic — หลายตัวคือความกำกวมที่
      // ต้องให้ resolver ที่มีกฎ หรือเจ้าของเป็นผู้ตัด ไม่ใช่ planner เดาเอง
      ambiguous.push({ capability, candidates: candidates.map((c) => c.unit_id) });
      return;
    }
    const unit: AssemblyUnitV2 = candidates[0];
    if (!nodes.has(unit.unit_id)) {
      nodes.set(unit.unit_id, {
        unit_id: unit.unit_id, capability, depth,
        entrypoint_ref: unit.entrypoint_ref, ports_in: unit.ports_in, ports_out: unit.ports_out,
      });
    }
    if (parent !== null) edges.push({ from: unit.unit_id, to: parent, capability });
    for (const need of unit.requires_capabilities) expand(need, depth + 1, unit.unit_id);
  };

  for (const cap of requested) expand(cap, 0, null);

  const chosen = [...nodes.keys()].map((id) => unitById(id)!).filter((u) => u !== null);
  const unavailable = chosen.filter((u) => u.availability !== "AVAILABLE")
    .map((u) => ({ unit_id: u.unit_id, availability: u.availability }));
  const neededResources = [...new Set(chosen.flatMap((u) => u.resource_requirements))];
  const unmetResources = neededResources.filter((r) => !context.available_resources.includes(r));
  const neededAuthority = [...new Set(chosen.flatMap((u) => u.authority_requirements))];
  const unmetAuthority = neededAuthority.filter((a) => !context.granted_authority.includes(a));

  return {
    schema: "ASSEMBLY_PLAN_V1",
    requested_capabilities: requested,
    nodes: [...nodes.values()].sort((a, b) => b.depth - a.depth),
    edges, missing_capabilities: [...new Set(missing)], ambiguous_capabilities: ambiguous,
    unavailable_units: unavailable, unmet_resources: unmetResources, unmet_authority: unmetAuthority,
    resolvable: missing.length === 0 && ambiguous.length === 0 && unavailable.length === 0
      && unmetResources.length === 0 && unmetAuthority.length === 0,
    llm_calls: 0,
  };
}

/** capability ทั้งหมดที่ประกาศไว้ — ใช้ตอบว่า "ระบบทำอะไรได้บ้าง" โดยไม่อ่านซอร์ส */
export function declaredCapabilities(): readonly string[] {
  return [...new Set(units().flatMap((u) => u.provides_capabilities))].sort();
}
