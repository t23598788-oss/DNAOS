/**
 * หน้าที่: ตัดสินว่าทรัพยากรตัวหนึ่งใช้กับงานนี้ได้หรือไม่ แบบกำหนดผลแน่นอน
 *
 * Owner, 2026-09-05 ข้อ 8: ลำดับการตัดสินคงที่
 *   CAPABILITY → CONTRACT → DATA POLICY → AUTHORITY → AVAILABILITY → COST
 * และต้นทุน "ห้าม override สิทธิ์ นโยบาย หรือความเข้ากันของสัญญา"
 * ในโค้ดนี้จึงตรวจต้นทุนเป็นด่านสุดท้ายเสมอ และมันตัดออกได้อย่างเดียว
 * ไม่มีทางทำให้อะไรที่ตกไปแล้วกลับมาผ่าน
 *
 * ข้อ 6: นโยบายข้อมูลไม่ผ่าน = INELIGIBLE ไม่ใช่คำเตือน
 *
 * Dependency ที่อนุญาต: ./types.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเรียกโมเดลภาษาใด ๆ ในไฟล์นี้
 * - ห้ามให้ UNKNOWN นับเป็นผ่าน
 */

import {
  DEFAULT_DENY_POLICY, NEVER_TRANSMITTABLE,
  type DataAccessPolicyV1, type EligibilityCheck, type ResourceEligibility,
  type ResourceRequest, type ResourceV1,
} from "./types";

export interface PolicyLookup {
  (policyRef: string): DataAccessPolicyV1 | null;
}

/** ข้อ 7: availability ที่ใช้จริง มาจากหลายแหล่งรวมกัน ไม่ใช่ค่าที่ประกาศไว้เฉย ๆ */
export function effectiveAvailability(r: ResourceV1): { state: ResourceV1["availability_state"]; why: string } {
  if (r.subscription_state === "INACTIVE") {
    return { state: "UNAVAILABLE", why: "บริการถูกปิดอยู่ (subscription INACTIVE)" };
  }
  if (r.health !== null) {
    // หลักฐานสุขภาพจริงชนะค่าที่ประกาศไว้เสมอ
    return { state: r.health.state, why: `จากการตรวจสุขภาพ ${r.health.checked_at}: ${r.health.detail}` };
  }
  if (r.availability_state === "DECLARED_AVAILABLE") {
    return { state: "UNKNOWN", why: "ประกาศว่าพร้อม แต่ยังไม่เคยตรวจสุขภาพจริง" };
  }
  return { state: r.availability_state, why: r.availability_reason ?? "ตามที่ประกาศไว้" };
}

export function checkEligibility(
  resource: ResourceV1,
  request: ResourceRequest,
  lookupPolicy: PolicyLookup,
): ResourceEligibility {
  const checks: EligibilityCheck[] = [];
  const add = (check: EligibilityCheck["check"], verdict: EligibilityCheck["verdict"], detail: string) =>
    checks.push({ check, verdict, detail });

  // 1 CAPABILITY — provider ทำได้ ไม่พอ ต้องได้รับอนุญาตจาก DNA OS ด้วย
  const grant = resource.capabilities.find((c) => c.capability === request.capability);
  if (grant === undefined) {
    add("CAPABILITY", "INELIGIBLE", `ไม่ได้ประกาศ capability ${request.capability}`);
  } else if (!grant.provider_supports) {
    add("CAPABILITY", "INELIGIBLE", `ผู้ให้บริการไม่รองรับ ${request.capability}`);
  } else if (!grant.dna_os_allows) {
    add("CAPABILITY", "INELIGIBLE", `ผู้ให้บริการรองรับ แต่ DNA OS ไม่อนุญาต — ${grant.reason}`);
  } else {
    add("CAPABILITY", "ELIGIBLE", request.capability);
  }

  // 2 CONTRACT
  if (request.required_output_contract === null) {
    add("CONTRACT", "ELIGIBLE", "งานไม่ได้บังคับสัญญาผลลัพธ์");
  } else if (resource.output_contracts.includes(request.required_output_contract)) {
    add("CONTRACT", "ELIGIBLE", request.required_output_contract);
  } else {
    add("CONTRACT", "INELIGIBLE",
      `คืน ${resource.output_contracts.join(", ") || "(ไม่ประกาศ)"} แต่งานต้องการ ${request.required_output_contract}`);
  }

  // 3 DATA POLICY — ค่าปริยายคือปฏิเสธ
  const policy = lookupPolicy(resource.data_access_policy_ref) ?? DEFAULT_DENY_POLICY;
  const deniedByClass = request.data_classes.filter(
    (c) => policy.denied_data_classes.includes(c) || !policy.allowed_data_classes.includes(c),
  );
  const neverAllowed = request.data_classes.filter((c) => NEVER_TRANSMITTABLE.includes(c));
  if (neverAllowed.length > 0) {
    add("DATA_POLICY", "INELIGIBLE", `ชนิดข้อมูลที่ห้ามส่งออกเสมอ: ${neverAllowed.join(", ")}`);
  } else if (deniedByClass.length > 0) {
    add("DATA_POLICY", "INELIGIBLE", `นโยบายไม่อนุญาตให้เห็น: ${deniedByClass.join(", ")}`);
  } else if (!policy.read_allowed) {
    add("DATA_POLICY", "INELIGIBLE", "นโยบายไม่อนุญาตให้อ่านข้อมูล");
  } else if (policy.purpose_constraints.length > 0 && !policy.purpose_constraints.includes(request.purpose)) {
    add("DATA_POLICY", "INELIGIBLE", `วัตถุประสงค์ "${request.purpose}" ไม่อยู่ในที่อนุญาต`);
  } else if (request.requires_canonical_write && !policy.canonical_state_write_allowed) {
    add("DATA_POLICY", "INELIGIBLE", "งานต้องเขียนสถานะหลัก แต่นโยบายไม่อนุญาต");
  } else if (!policy.external_transmission_allowed && resource.connection_method !== "IN_PROCESS") {
    add("DATA_POLICY", "INELIGIBLE", "นโยบายไม่อนุญาตให้ส่งข้อมูลออกนอกระบบ");
  } else {
    add("DATA_POLICY", "ELIGIBLE", `อนุญาต ${request.data_classes.join(", ") || "(ไม่มีข้อมูล)"} เพื่อ ${request.purpose}`);
  }

  // 4 AUTHORITY
  const missingAuthority = policy.authority_required.filter((a) => !request.granted_authority.includes(a));
  const missingPermission = resource.permissions.filter(
    (p) => p.startsWith("REQUIRES:") && !request.granted_authority.includes(p.slice("REQUIRES:".length)),
  );
  if (missingAuthority.length > 0 || missingPermission.length > 0) {
    add("AUTHORITY", "INELIGIBLE", `สิทธิ์ที่ยังไม่ได้รับ: ${[...missingAuthority, ...missingPermission].join(", ")}`);
  } else {
    add("AUTHORITY", "ELIGIBLE", request.granted_authority.join(", ") || "ไม่ต้องการสิทธิ์เพิ่ม");
  }

  // 5 AVAILABILITY
  const avail = effectiveAvailability(resource);
  if (avail.state === "HEALTH_AVAILABLE") add("AVAILABILITY", "ELIGIBLE", avail.why);
  else if (avail.state === "DEGRADED") add("AVAILABILITY", "ELIGIBLE", `ใช้ได้แต่ไม่เต็มที่ — ${avail.why}`);
  else if (avail.state === "UNAVAILABLE") add("AVAILABILITY", "INELIGIBLE", avail.why);
  else add("AVAILABILITY", "UNKNOWN", avail.why);

  // 6 COST — ด่านสุดท้าย ตัดออกได้อย่างเดียว
  const cost = resource.cost_policy;
  if (cost.billing_state === "SUSPENDED") {
    add("COST", "INELIGIBLE", "การเรียกเก็บเงินถูกระงับ");
  } else if (request.budget_ceiling !== null && cost.estimated_unit_cost !== null
    && cost.estimated_unit_cost > request.budget_ceiling) {
    add("COST", "INELIGIBLE", `ต้นทุน ${cost.estimated_unit_cost} ${cost.currency} เกินเพดาน ${request.budget_ceiling}`);
  } else {
    add("COST", "ELIGIBLE", `${cost.cost_class}${cost.estimated_unit_cost !== null ? ` ${cost.estimated_unit_cost} ${cost.currency}` : ""}`);
  }

  const hasIneligible = checks.some((c) => c.verdict === "INELIGIBLE");
  const hasUnknown = checks.some((c) => c.verdict === "UNKNOWN");
  const verdict = hasIneligible ? "INELIGIBLE" : hasUnknown ? "UNKNOWN" : "ELIGIBLE";

  return {
    resource_id: resource.resource_id, verdict, checks,
    blocking: checks.filter((c) => c.verdict !== "ELIGIBLE").map((c) => `${c.check}: ${c.detail}`),
  };
}

export interface SelectionOutcome {
  readonly capability: string;
  readonly selected: ResourceV1 | null;
  readonly reason: string;
  readonly evaluated: readonly ResourceEligibility[];
  readonly llm_calls: 0;
}

/**
 * เลือกทรัพยากรตัวเดียวแบบกำหนดผลได้
 * เมื่อมีหลายตัวที่ผ่าน ใช้ลำดับ fallback ก่อน แล้วจึงต้นทุน แล้วจึงชื่อ
 * (ชื่อเป็นตัวตัดสินสุดท้ายเพื่อให้ผลเหมือนเดิมทุกครั้ง ไม่ขึ้นกับลำดับในไฟล์)
 */
export function selectResource(
  resources: readonly ResourceV1[],
  request: ResourceRequest,
  lookupPolicy: PolicyLookup,
): SelectionOutcome {
  const evaluated = resources.map((r) => checkEligibility(r, request, lookupPolicy));
  const eligible = resources.filter((r) => evaluated.find((e) => e.resource_id === r.resource_id)?.verdict === "ELIGIBLE");

  if (eligible.length === 0) {
    return {
      capability: request.capability, selected: null,
      reason: "RESOURCE_UNAVAILABLE — ไม่มีทรัพยากรใดผ่านทุกด่าน",
      evaluated, llm_calls: 0,
    };
  }

  const ranked = [...eligible].sort((a, b) => {
    if (a.fallback_priority !== b.fallback_priority) return a.fallback_priority - b.fallback_priority;
    const ca = a.cost_policy.estimated_unit_cost ?? Number.MAX_SAFE_INTEGER;
    const cb = b.cost_policy.estimated_unit_cost ?? Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;
    return a.resource_id.localeCompare(b.resource_id);
  });

  return {
    capability: request.capability, selected: ranked[0],
    reason: `เลือกจาก ${eligible.length} ตัวที่ผ่าน — ลำดับสำรอง ${ranked[0].fallback_priority} · ต้นทุน ${ranked[0].cost_policy.estimated_unit_cost ?? "ไม่ระบุ"}`,
    evaluated, llm_calls: 0,
  };
}
