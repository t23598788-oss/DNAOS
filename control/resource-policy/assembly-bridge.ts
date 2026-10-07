/**
 * หน้าที่: ต่อชั้นนโยบายทรัพยากรเข้ากับเครื่องประกอบเดิม
 *
 * Owner, 2026-09-05 ข้อ 6: ลำดับต้องเป็น
 *   capability lookup → port compatibility → availability → data access
 *   → authority → cost policy → resource selection
 *
 * ไฟล์นี้เป็นตัวเชื่อม ไม่ใช่ router ใหม่ — มันเรียก checkPortCompatibility ของ
 * control/assembly ตามเดิมสำหรับด้านสัญญา และเรียก checkEligibility ของที่นี่
 * สำหรับด้านนโยบาย แล้วรวมผลโดยไม่ตัดสินซ้ำซ้อน
 *
 * Dependency ที่อนุญาต: control/assembly/* ./eligibility.ts ./registry.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามแก้ control/assembly
 * - ห้ามให้ผลจากด้านหนึ่งไปกลบผลปฏิเสธของอีกด้าน
 */

import { checkPortCompatibility } from "../assembly/port-compatibility";
import { portById } from "../assembly/registry";
import { checkEligibility } from "./eligibility";
import { policyByRef, resourcesProviding } from "./registry";
import type { ResourceEligibility, ResourceRequest, ResourceV1 } from "./types";

export interface CombinedVerdict {
  readonly resource_id: string;
  readonly verdict: "ELIGIBLE" | "ADAPTER_REQUIRED" | "INELIGIBLE" | "UNKNOWN";
  readonly policy: ResourceEligibility;
  readonly contract: { verdict: string; blocking: readonly string[] } | null;
  readonly blocking: readonly string[];
}

/**
 * รวมสองด้าน: สัญญา/พอร์ต จาก control/assembly และนโยบาย/สิทธิ์จากที่นี่
 * ตัวไหนปฏิเสธ ผลรวมปฏิเสธทันที — ไม่มีการถัวเฉลี่ย
 */
export function evaluateResourceForRequest(
  resource: ResourceV1,
  request: ResourceRequest,
  options: { producerPortId?: string; consumerPortId?: string } = {},
): CombinedVerdict {
  const policy = checkEligibility(resource, request, policyByRef);

  let contract: CombinedVerdict["contract"] = null;
  if (options.producerPortId !== undefined && options.consumerPortId !== undefined) {
    const a = portById(options.producerPortId);
    const b = portById(options.consumerPortId);
    if (a === null || b === null) {
      contract = { verdict: "UNKNOWN", blocking: [`หา port ไม่เจอ: ${a === null ? options.producerPortId : options.consumerPortId}`] };
    } else {
      const r = checkPortCompatibility(a, b, { grantedAuthority: request.granted_authority });
      contract = { verdict: r.verdict, blocking: r.blocking };
    }
  }

  const blocking = [
    ...policy.blocking,
    ...(contract?.blocking ?? []),
  ];

  const verdict: CombinedVerdict["verdict"] =
    policy.verdict === "INELIGIBLE" || contract?.verdict === "INCOMPATIBLE" ? "INELIGIBLE"
      : policy.verdict === "UNKNOWN" || contract?.verdict === "UNKNOWN" ? "UNKNOWN"
        : contract?.verdict === "ADAPTER_REQUIRED" ? "ADAPTER_REQUIRED"
          : "ELIGIBLE";

  return { resource_id: resource.resource_id, verdict, policy, contract, blocking };
}

export interface CapabilityRoutingResult {
  readonly capability: string;
  readonly candidates: readonly CombinedVerdict[];
  readonly selected: string | null;
  readonly reason: string;
  readonly llm_calls: 0;
}

/**
 * ตอบคำถาม "งานนี้ต้องการ capability นี้ ใครทำได้และได้รับอนุญาต"
 * โดยไม่ต้องรู้ชื่อผู้ให้บริการล่วงหน้าเลย
 */
export function routeCapability(request: ResourceRequest): CapabilityRoutingResult {
  const candidates = resourcesProviding(request.capability).map((r) => evaluateResourceForRequest(r, request));
  const eligible = candidates.filter((c) => c.verdict === "ELIGIBLE");

  if (eligible.length === 0) {
    return {
      capability: request.capability, candidates, selected: null,
      reason: candidates.length === 0
        ? "RESOURCE_UNAVAILABLE — ไม่มีทรัพยากรใดประกาศ capability นี้และได้รับอนุญาต"
        : "RESOURCE_UNAVAILABLE — มีผู้ประกาศ capability แต่ไม่มีตัวใดผ่านทุกด่าน",
      llm_calls: 0,
    };
  }
  // การจัดลำดับใช้ตัวเดียวกับ selectResource เพื่อไม่ให้มีสองกติกา
  const byId = new Map(resourcesProviding(request.capability).map((r) => [r.resource_id, r]));
  const ranked = [...eligible].sort((x, y) => {
    const a = byId.get(x.resource_id)!;
    const b = byId.get(y.resource_id)!;
    if (a.fallback_priority !== b.fallback_priority) return a.fallback_priority - b.fallback_priority;
    const ca = a.cost_policy.estimated_unit_cost ?? Number.MAX_SAFE_INTEGER;
    const cb = b.cost_policy.estimated_unit_cost ?? Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;
    return a.resource_id.localeCompare(b.resource_id);
  });
  return {
    capability: request.capability, candidates, selected: ranked[0].resource_id,
    reason: `เลือกจาก ${eligible.length} ตัวที่ผ่านทุกด่าน`, llm_calls: 0,
  };
}
