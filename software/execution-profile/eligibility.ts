/**
 * หน้าที่: ตัดสินว่า resource หนึ่งใช้กับงานหนึ่งได้หรือไม่ โดยดูจาก profile —
 * ไม่ดูชื่อ ไม่ดู provider (Owner, ข้อ 4).
 *
 * กฎที่สำคัญที่สุดและเป็นเหตุผลที่ไฟล์นี้ไม่ใช่แค่ `every(fact => KNOWN)`:
 * **UNKNOWN ปิดกั้นเฉพาะเมื่อข้อเท็จจริงนั้นจำเป็นกับงานนี้จริง ๆ**
 *
 *   งานที่ไม่ต้องใช้บริการที่มีค่าใช้จ่าย → สถานะ billing ไม่เกี่ยว ตอบ NOT_APPLICABLE
 *   งานที่ต้องใช้ และ billing เป็น UNKNOWN → ตอบ UNKNOWN ไม่ใช่ ELIGIBLE และไม่ใช่
 *   NOT_ELIGIBLE เพราะ "ยังไม่รู้" กับ "รู้ว่าไม่ได้" เป็นคนละคำตอบ
 *
 * ถ้าประกาศว่า UNKNOWN ทุกตัวคือใช้ไม่ได้ ระบบจะบอกว่าเครื่องมือทุกตัวใช้ไม่ได้
 * ทั้งที่หลายตัวทำงานอยู่จริงวันนี้ — นั่นคือความเข้มงวดที่ให้คำตอบผิด
 *
 * เฟสนี้ยังไม่ต่อเข้า routing จริง ไฟล์นี้จึงเป็น "ความหมายของ eligibility"
 * ที่ทดสอบได้ ไม่ใช่ตัวเลือกที่ทำงานอยู่
 *
 * Input: `ExecutionProfile` + `EligibilityRequest`.
 * Output: `decideEligibility`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้ามอ่านชื่อ resource มาตัดสิน, ห้ามให้ UNKNOWN กลายเป็น ELIGIBLE,
 * ห้ามยุบ UNKNOWN กับ NOT_ELIGIBLE เข้าด้วยกัน.
 */

import type { EligibilityCheck, EligibilityDecision, EligibilityRequest, ExecutionProfile, Fact } from "./types";

const check = (name: string, verdict: EligibilityCheck["verdict"], reason_code: string, detail: string): EligibilityCheck =>
  ({ check: name, verdict, reason_code, detail });

/** ข้อเท็จจริงบูลีนที่ "ต้องเป็นจริง" — UNKNOWN คือ UNKNOWN ไม่ใช่ false */
function requireTrue(name: string, fact: Fact<boolean>, code: string): EligibilityCheck {
  if (fact.state === "NOT_APPLICABLE") return check(name, "ELIGIBLE", "NOT_APPLICABLE", fact.source ?? "");
  if (fact.state === "UNKNOWN") return check(name, "UNKNOWN", `${code}_UNKNOWN`, fact.source ?? "ไม่ทราบ");
  return fact.value === true
    ? check(name, "ELIGIBLE", code, fact.source ?? "")
    : check(name, "NOT_ELIGIBLE", `${code}_FALSE`, fact.source ?? "");
}

export function decideEligibility(profile: ExecutionProfile, request: EligibilityRequest): EligibilityDecision {
  const checks: EligibilityCheck[] = [];

  // 1. ลงทะเบียนแล้ว — profile มีอยู่ได้ก็ต่อเมื่อมี resource_id ของ canonical
  checks.push(profile.resource_id.trim() !== ""
    ? check("REGISTERED", "ELIGIBLE", "REGISTERED", profile.resource_id)
    : check("REGISTERED", "NOT_ELIGIBLE", "NOT_REGISTERED", "ไม่มี resource_id"));

  // 2. ความสามารถตรงกับที่งานต้องการ
  const missing = request.required_capability_ids.filter((id) => !profile.capability_ids.includes(id));
  checks.push(request.required_capability_ids.length === 0
    ? check("CAPABILITY_MATCH", "UNKNOWN", "NO_CAPABILITY_REQUESTED", "งานไม่ได้ระบุความสามารถที่ต้องการ")
    : missing.length === 0
      ? check("CAPABILITY_MATCH", "ELIGIBLE", "CAPABILITY_MATCH", profile.capability_ids.join(","))
      : check("CAPABILITY_MATCH", "NOT_ELIGIBLE", "CAPABILITY_MISSING", missing.join(",")));

  // 3. สิทธิ์ของผู้เรียก — ประกาศไว้ที่ permission_requirements
  checks.push(profile.permission_requirements.state === "KNOWN"
    ? check("PERMISSION_ALLOWED", "ELIGIBLE", "PERMISSION_DECLARED", (profile.permission_requirements.value ?? []).join(","))
    : check("PERMISSION_ALLOWED", "UNKNOWN", "PERMISSION_UNDECLARED", profile.permission_requirements.source ?? ""));

  // 4. ติดตั้งอยู่จริง
  checks.push(requireTrue("INSTALLED", profile.facts.installed, "INSTALLED"));

  // 5. ยืนยันตัวตนได้ — คนละเรื่องกับติดตั้ง
  checks.push(requireTrue("AUTH_AVAILABLE", profile.facts.auth_available, "AUTH"));

  /**
   * 6-7. subscription / billing — ผูกกับความต้องการของ "งาน" ไม่ใช่ของ resource
   * งานที่ไม่ต้องใช้บริการมีค่าใช้จ่าย ไม่ต้องรู้สองอย่างนี้เลย
   */
  if (!request.requires_paid_service) {
    checks.push(check("SUBSCRIPTION_VALID", "ELIGIBLE", "NOT_APPLICABLE", "งานนี้ไม่ต้องใช้บริการที่มีค่าใช้จ่าย"));
    checks.push(check("BILLING_ACTIVE", "ELIGIBLE", "NOT_APPLICABLE", "งานนี้ไม่ต้องใช้บริการที่มีค่าใช้จ่าย"));
  } else {
    checks.push(requireTrue("SUBSCRIPTION_VALID", profile.facts.subscription_valid, "SUBSCRIPTION"));
    checks.push(requireTrue("BILLING_ACTIVE", profile.facts.billing_active, "BILLING"));
  }

  // 8. สุขภาพ
  checks.push(requireTrue("HEALTHY", profile.facts.healthy, "HEALTH"));
  // 9. พร้อมใช้
  checks.push(requireTrue("AVAILABLE", profile.facts.available, "AVAILABILITY"));

  // 10. โควตางานพร้อมกัน — ไม่ประกาศ = ไม่รู้ ไม่ใช่ไม่จำกัด
  checks.push(profile.concurrency_limit.state === "KNOWN"
    ? check("CONCURRENCY_AVAILABLE", "ELIGIBLE", "CONCURRENCY_DECLARED", String(profile.concurrency_limit.value))
    : check("CONCURRENCY_AVAILABLE", "UNKNOWN", "CONCURRENCY_UNDECLARED", profile.concurrency_limit.source ?? ""));

  // 11. พื้นที่ทำงาน — ถามเฉพาะเมื่องานต้องใช้
  checks.push(!request.needs_workspace
    ? check("WORKSPACE_AVAILABLE", "ELIGIBLE", "NOT_APPLICABLE", "งานนี้ไม่ต้องใช้พื้นที่ทำงาน")
    : profile.workspace_policy.state === "KNOWN"
      ? check("WORKSPACE_AVAILABLE", "ELIGIBLE", "WORKSPACE_DECLARED", String(profile.workspace_policy.value))
      : check("WORKSPACE_AVAILABLE", "UNKNOWN", "WORKSPACE_UNDECLARED", profile.workspace_policy.source ?? ""));

  // สรุป: NOT_ELIGIBLE ชนะทุกอย่าง แล้วจึง UNKNOWN แล้วจึง ELIGIBLE
  const blocking = checks.find((c) => c.verdict === "NOT_ELIGIBLE");
  const unresolved = checks.find((c) => c.verdict === "UNKNOWN");
  const verdict = blocking ? "NOT_ELIGIBLE" : unresolved ? "UNKNOWN" : "ELIGIBLE";
  return {
    resource_id: profile.resource_id,
    verdict,
    checks,
    blocking_reason: blocking ? `${blocking.check}:${blocking.reason_code}` : unresolved ? `${unresolved.check}:${unresolved.reason_code}` : null,
  };
}
