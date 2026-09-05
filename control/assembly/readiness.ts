/**
 * หน้าที่: ตัดสินว่าแต่ละ capability ไปถึงขั้นไหนแล้ว โดยห้ามข้ามขั้น
 *
 * Owner, 2026-09-05 ข้อ 26:
 * NOT_DOCUMENTED -> DOCUMENTED -> CONTRACTED -> LINKABLE -> EXECUTABLE -> RUNTIME_VERIFIED
 *
 * LINKABLE ต้องมีครบ: spec, ports, schemas, dependencies, authority,
 * กติกาผูกทรัพยากร และตัวตรวจ
 * EXECUTABLE ต้องเป็น LINKABLE บวกกับมี entrypoint ที่เรียกได้จริงลงทะเบียนไว้
 * RUNTIME_VERIFIED ต้องมีหลักฐานจากเครื่องจริงเท่านั้น
 *
 * Dependency ที่อนุญาต: ./registry.ts ./planner.ts ./linker.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเลื่อนขั้นจากความตั้งใจ ต้องเลื่อนจากสิ่งที่ตรวจได้
 * - ห้ามตั้ง RUNTIME_VERIFIED โดยไม่มีหลักฐานการรันจริง
 */

import { link } from "./linker";
import { planAssembly } from "./planner";
import { ports, units } from "./registry";
import type { ReadinessState } from "./types";

export interface CapabilityReadiness {
  readonly capability: string;
  readonly unit_id: string | null;
  readonly state: ReadinessState;
  readonly missing_for_next: readonly string[];
}

const CONTEXT = {
  available_resources: ["supabase", "line", "ai-provider", "company-settings", "longdo-map"],
  granted_authority: ["ADMIN_TIER", "MACHINE_SECRET"],
};

export function capabilityReadiness(runtimeVerified: readonly string[] = []): readonly CapabilityReadiness[] {
  const allPorts = new Map(ports().map((p) => [p.port_id, p]));
  const out: CapabilityReadiness[] = [];

  for (const cap of [...new Set(units().flatMap((u) => u.provides_capabilities))].sort()) {
    const unit = units().find((u) => u.provides_capabilities.includes(cap)) ?? null;
    if (unit === null) { out.push({ capability: cap, unit_id: null, state: "NOT_DOCUMENTED", missing_for_next: ["ไม่มี unit"] }); continue; }

    const gaps: string[] = [];
    const unitPorts = [...unit.ports_in, ...unit.ports_out].map((p) => allPorts.get(p)).filter((p) => p !== undefined);
    if (unitPorts.length === 0) gaps.push("ไม่มี port ที่ประกาศไว้");
    if (unit.data_contracts.length === 0) gaps.push("ไม่มี data contract");
    if (unit.verification_profile === null) gaps.push("ไม่มีตัวตรวจ");
    if (unit.resource_requirements.length === 0 && unitPorts.some((p) => p!.availability_requirement.length > 0)) {
      gaps.push("port ต้องการทรัพยากรแต่ unit ไม่ได้ประกาศ");
    }

    // CONTRACTED = มีสัญญาครบพอให้เครื่องอ่านได้
    if (gaps.length > 0) { out.push({ capability: cap, unit_id: unit.unit_id, state: "DOCUMENTED", missing_for_next: gaps }); continue; }

    const plan = planAssembly([cap], CONTEXT);
    const res = link(plan, CONTEXT);
    if (res.verdict !== "LINKABLE") {
      out.push({ capability: cap, unit_id: unit.unit_id, state: "CONTRACTED", missing_for_next: res.problems.slice(0, 3) });
      continue;
    }
    if (unit.entrypoint_ref === null) {
      out.push({ capability: cap, unit_id: unit.unit_id, state: "LINKABLE", missing_for_next: ["ไม่มี entrypoint ที่ลงทะเบียนไว้"] });
      continue;
    }
    if (runtimeVerified.includes(cap)) {
      out.push({ capability: cap, unit_id: unit.unit_id, state: "RUNTIME_VERIFIED", missing_for_next: [] });
    } else {
      out.push({ capability: cap, unit_id: unit.unit_id, state: "EXECUTABLE", missing_for_next: ["ยังไม่มีหลักฐานการรันจริงจากเครื่อง"] });
    }
  }
  return out;
}
