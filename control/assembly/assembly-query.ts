/**
 * หน้าที่: ตอบคำถามการประกอบทั้งหมดโดยไม่อ่านซอร์ส
 *
 * Owner, 2026-09-05 ข้อ 30: DNA OS ต้องตอบได้ว่าจะเรียก capability อย่างไร
 * ส่งอะไร ได้อะไร ต่อกับอะไรได้ ถ้าไม่ได้เพราะอะไร ใครเป็นเจ้าของข้อมูล
 * flow หยุดตรงไหน ใครเปลี่ยน state ได้ กระทบเงินอย่างไร หน้าไหนแสดง
 * และถ้าจะประกอบบริษัทใหม่ต้อง bind อะไร
 *
 * ทุกคำตอบมาจาก contract ในโฟลเดอร์ data เท่านั้น
 *
 * Dependency ที่อนุญาต: ./registry.ts ./planner.ts ./linker.ts ./port-compatibility.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเปิดไฟล์ซอร์สของระบบปลายทางเพื่อตอบคำถาม
 */

import { link } from "./linker";
import { planAssembly, type PlanContext } from "./planner";
import { checkPortCompatibility } from "./port-compatibility";
import {
  commandById, commands, contractById, financialEffects, ownership, portById,
  projections, stateMachines, unitById, units, unitsProviding,
} from "./registry";

const DEFAULT_CONTEXT: PlanContext = {
  available_resources: ["supabase", "line", "ai-provider", "company-settings"],
  granted_authority: ["ADMIN_TIER", "MACHINE_SECRET"],
};

/** จะเรียก capability นี้ยังไง ต้องส่งอะไร ได้อะไรกลับ */
export function howToCall(capability: string) {
  const providers = unitsProviding(capability);
  if (providers.length === 0) return { capability, known: false as const, reason: "ไม่มี unit ใดประกาศ capability นี้" };
  const u = providers[0];
  const inPort = u.ports_in.map(portById).find((p) => p !== null) ?? null;
  const outPort = u.ports_out.map(portById).find((p) => p !== null) ?? null;
  return {
    capability, known: true as const, unit_id: u.unit_id, entrypoint: u.entrypoint_ref,
    transport: inPort?.transport ?? null, operation: inPort?.operation ?? null,
    input_schema: inPort?.input_schema_ref ?? null,
    input_contract: inPort?.input_schema_ref ? contractById(inPort.input_schema_ref) : null,
    output_schema: outPort?.output_schema_ref ?? inPort?.output_schema_ref ?? null,
    authentication: inPort?.authentication ?? null,
    authority_class: inPort?.authority_class ?? null,
    required_resources: u.resource_requirements,
    preconditions: u.preconditions, failure_modes: u.failure_modes,
    availability: u.availability,
  };
}

/** ต่อ X เข้ากับ Y ได้ไหม ถ้าไม่ได้เพราะอะไร ต้องมีตัวแปลงหรือเปล่า */
export function canConnect(
  producerPortId: string, consumerPortId: string,
  context: Partial<PlanContext> & { via_capability?: string } = {},
) {
  const a = portById(producerPortId); const raw = portById(consumerPortId);
  if (a === null || raw === null) return { verdict: "UNKNOWN" as const, reason: `หา port ไม่เจอ: ${a === null ? producerPortId : consumerPortId}` };
  /**
   * ถ้าระบุว่าต่อ "ในฐานะ dependency ของ capability ไหน" ให้เทียบกับ schema ที่
   * ผู้บริโภคประกาศว่ารับจาก capability นั้น ไม่ใช่ input ทั้งก้อนของมัน —
   * ตรงกับที่ linker ใช้จริง ไม่งั้นคำตอบสองที่จะไม่ตรงกัน
   */
  let b = raw;
  if (context.via_capability !== undefined) {
    const consumerUnit = unitById(raw.owner_unit);
    const expected = consumerUnit?.dependency_inputs?.[context.via_capability];
    if (expected !== undefined) b = { ...raw, input_schema_ref: expected };
  }
  const r = checkPortCompatibility(a, b, {
    availableResources: context.available_resources ?? DEFAULT_CONTEXT.available_resources,
    grantedAuthority: context.granted_authority ?? DEFAULT_CONTEXT.granted_authority,
  });
  return { verdict: r.verdict, adapter_required: r.verdict === "ADAPTER_REQUIRED", checks: r.checks, blocking: r.blocking };
}

/** ใครเป็นเจ้าของข้อมูลนี้ ใครเขียน ใครอ่าน */
export function dataOwner(object: string) {
  return ownership().find((o) => o.object === object) ?? null;
}

/** state ต่อไปคืออะไร ใครมีสิทธิ์เปลี่ยน */
export function nextStates(entityOrMachine: string, from: string) {
  const m = stateMachines().find((x) => x.machine_id === entityOrMachine || x.entity === entityOrMachine);
  if (m === undefined) return { known: false as const, reason: "ไม่มี state machine ที่ประกาศไว้สำหรับสิ่งนี้" };
  const outgoing = m.transitions.filter((t) => t.from === from);
  return {
    known: true as const, machine_id: m.machine_id, from,
    is_terminal: m.terminal_states.includes(from),
    transitions: outgoing.map((t) => ({
      to: t.to, trigger: t.trigger, actor: t.actor, authority: t.authority,
      implementation_owner: t.implementation_owner,
      dead_end: t.implementation_owner === null,
    })),
    dead_end_state: outgoing.length === 0 && !m.terminal_states.includes(from),
  };
}

/** ผลกระทบทางเงินของคำสั่งนี้ */
export function moneyEffectOfCommand(commandId: string) {
  return financialEffects().filter((f) => f.source_transaction === commandId);
}

/** หน้าไหนแสดงข้อมูลนี้ */
export function surfacesShowing(object: string) {
  return projections().filter((p) => p.source_entities.includes(object));
}

/** จะประกอบให้บริษัทใหม่ต้อง bind อะไรบ้าง */
export function bindingRequirementsFor(capabilities: readonly string[], context: PlanContext = DEFAULT_CONTEXT) {
  const plan = planAssembly(capabilities, context);
  const chosen = plan.nodes.map((n) => unitById(n.unit_id)!).filter((u) => u !== null);
  return {
    units: chosen.map((u) => u.unit_id),
    resources: [...new Set(chosen.flatMap((u) => u.resource_requirements))].sort(),
    authority: [...new Set(chosen.flatMap((u) => u.authority_requirements))].sort(),
    data_objects_written: [...new Set(ownership()
      .filter((o) => o.owner_capability !== null && capabilities.includes(o.owner_capability))
      .map((o) => o.object))].sort(),
    entrypoints: chosen.map((u) => u.entrypoint_ref).filter((e): e is string => e !== null),
    unresolved: {
      missing_capabilities: plan.missing_capabilities,
      unavailable_units: plan.unavailable_units,
      unmet_resources: plan.unmet_resources,
      unmet_authority: plan.unmet_authority,
    },
  };
}

/** §27 แปลง command id ที่กำหนดไว้ล่วงหน้า เป็นแผน + ผลการต่อ โดยไม่เรียกโมเดลภาษา */
export function resolveCommand(commandId: string, context: PlanContext = DEFAULT_CONTEXT) {
  const spec = commandById(commandId);
  if (spec === null) return { ok: false as const, reason_code: "UNKNOWN_COMMAND", llm_calls: 0 as const };
  const plan = planAssembly(spec.required_capabilities, context);
  const result = link(plan, context);
  return { ok: true as const, command_id: commandId, spec, plan, link: result, llm_calls: 0 as const };
}

export const catalogSummary = () => ({
  units: units().length,
  commands: commands().length,
  capabilities: [...new Set(units().flatMap((u) => u.provides_capabilities))].length,
});
