/**
 * หน้าที่: พิสูจน์ว่าการเลือกทรัพยากรตัดสินได้แน่นอนและไม่เรียกโมเดลภาษา
 *
 * Owner, 2026-09-05 ข้อ 10-11: หกกรณีบังคับ และ LLM_CALL_COUNT ต้องเป็น 0
 *
 * กรณี D สำคัญที่สุด — ผู้ให้บริการทำได้แต่ DNA OS ไม่อนุญาต ต้องตกเสมอ
 */

import { checkEligibility, selectResource } from "./eligibility";
import { policyByRef, resources } from "./registry";
import { DEFAULT_DENY_POLICY, type DataAccessPolicyV1, type ResourceRequest, type ResourceV1 } from "./types";

const runpod = resources().find((r) => r.resource_id === "resource.runpod-ollama")!;

/** สำเนาที่แก้บางฟิลด์เพื่อสร้างสถานการณ์ทดสอบ — ไม่แตะไฟล์ทะเบียนจริง */
const variant = (over: Partial<ResourceV1>): ResourceV1 => ({ ...runpod, ...over });

const healthy = (id: string, over: Partial<ResourceV1> = {}): ResourceV1 => variant({
  resource_id: id, name: id,
  availability_state: "HEALTH_AVAILABLE",
  health: { checked_at: "2026-09-05T00:00:00Z", source: "HEALTH_CHECK", state: "HEALTH_AVAILABLE", detail: "ทดสอบ", evidence_ref: null },
  ...over,
});

const openPolicy: DataAccessPolicyV1 = {
  ...DEFAULT_DENY_POLICY,
  policy_id: "policy.test-open",
  allowed_data_classes: ["FINANCIAL_DOCUMENT", "PAYMENT_EVIDENCE"],
  denied_data_classes: ["CREDENTIAL", "SECRET", "CANONICAL_BUSINESS_STATE"],
  purpose_constraints: ["document.image.extract"],
  read_allowed: true,
  external_transmission_allowed: true,
};

const lookup = (ref: string): DataAccessPolicyV1 | null =>
  ref === "policy.test-open" ? openPolicy : policyByRef(ref);

const request = (over: Partial<ResourceRequest> = {}): ResourceRequest => ({
  capability: "document.image.extract",
  data_classes: ["PAYMENT_EVIDENCE"],
  purpose: "document.image.extract",
  required_output_contract: null,
  requires_canonical_write: false,
  granted_authority: [],
  budget_ceiling: null,
  ...over,
});

interface Case { id: string; name: string; run: () => { pass: boolean; got: string } }

const cases: Case[] = [
  {
    id: "A", name: "ตรงทุกด่าน → ELIGIBLE",
    run: () => {
      const r = checkEligibility(healthy("res.a", { data_access_policy_ref: "policy.test-open" }), request(), lookup);
      return { pass: r.verdict === "ELIGIBLE", got: r.verdict + " " + r.blocking.join(" · ") };
    },
  },
  {
    id: "B", name: "นโยบายห้ามเห็นข้อมูลชนิดนี้ → INELIGIBLE",
    run: () => {
      const r = checkEligibility(
        healthy("res.b", { data_access_policy_ref: "policy.test-open" }),
        request({ data_classes: ["CANONICAL_BUSINESS_STATE"] }), lookup);
      const blocked = r.checks.find((c) => c.check === "DATA_POLICY")?.verdict === "INELIGIBLE";
      return { pass: r.verdict === "INELIGIBLE" && blocked, got: r.verdict };
    },
  },
  {
    id: "C", name: "ทรัพยากรใช้งานไม่ได้ → INELIGIBLE",
    run: () => {
      const r = checkEligibility(
        variant({ resource_id: "res.c", data_access_policy_ref: "policy.test-open" }), request(), lookup);
      const blocked = r.checks.find((c) => c.check === "AVAILABILITY")?.verdict === "INELIGIBLE";
      return { pass: r.verdict === "INELIGIBLE" && blocked, got: r.verdict };
    },
  },
  {
    id: "D", name: "ผู้ให้บริการทำได้ แต่ DNA OS ไม่อนุญาต → INELIGIBLE",
    run: () => {
      const r = checkEligibility(
        healthy("res.d", { data_access_policy_ref: "policy.test-open" }),
        request({ capability: "finance.settle" }), lookup);
      const cap = r.checks.find((c) => c.check === "CAPABILITY");
      return {
        pass: r.verdict === "INELIGIBLE" && cap?.verdict === "INELIGIBLE" && cap.detail.includes("ไม่อนุญาต"),
        got: cap?.detail ?? "-",
      };
    },
  },
  {
    id: "E", name: "ผ่านสองตัว → ตัดสินด้วยลำดับสำรองและต้นทุนอย่างคงที่",
    run: () => {
      const cheap = healthy("res.cheap", {
        data_access_policy_ref: "policy.test-open", fallback_priority: 20,
        cost_policy: { ...runpod.cost_policy, estimated_unit_cost: 0.1 },
      });
      const preferred = healthy("res.preferred", {
        data_access_policy_ref: "policy.test-open", fallback_priority: 5,
        cost_policy: { ...runpod.cost_policy, estimated_unit_cost: 9.9 },
      });
      const a = selectResource([cheap, preferred], request(), lookup);
      const b = selectResource([preferred, cheap], request(), lookup);
      return {
        pass: a.selected?.resource_id === "res.preferred" && b.selected?.resource_id === "res.preferred",
        got: `${a.selected?.resource_id} / ${b.selected?.resource_id} (ลำดับสำรองมาก่อนต้นทุน · ผลเหมือนกันไม่ว่าเรียงยังไง)`,
      };
    },
  },
  {
    id: "F", name: "ไม่มีตัวไหนผ่าน → RESOURCE_UNAVAILABLE ไม่ใช่ชื่อผู้ให้บริการ",
    run: () => {
      const out = selectResource(resources(), request(), policyByRef);
      return {
        pass: out.selected === null && out.reason.startsWith("RESOURCE_UNAVAILABLE"),
        got: out.reason,
      };
    },
  },
  {
    id: "G", name: "ไม่มีนโยบาย → ใช้ค่าปริยายที่ปฏิเสธทุกอย่าง",
    run: () => {
      const r = checkEligibility(healthy("res.g", { data_access_policy_ref: "policy.ไม่มีอยู่จริง" }), request(), lookup);
      return { pass: r.verdict === "INELIGIBLE", got: r.checks.find((c) => c.check === "DATA_POLICY")?.detail ?? "-" };
    },
  },
  {
    id: "H", name: "ต้นทุนตัดออกได้ แต่ทำให้ของที่ตกไปแล้วกลับมาผ่านไม่ได้",
    run: () => {
      const overBudget = checkEligibility(
        healthy("res.h", { data_access_policy_ref: "policy.test-open" }),
        request({ budget_ceiling: 0.5 }), lookup);
      const denied = checkEligibility(
        healthy("res.h2", { data_access_policy_ref: "policy.test-open" }),
        request({ data_classes: ["SECRET"], budget_ceiling: null }), lookup);
      return {
        pass: overBudget.verdict === "INELIGIBLE" && denied.verdict === "INELIGIBLE",
        got: `เกินงบ=${overBudget.verdict} · ข้อมูลต้องห้าม=${denied.verdict}`,
      };
    },
  },
];

let pass = 0;
for (const c of cases) {
  const r = c.run();
  if (r.pass) pass++;
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${c.id}  ${c.name.padEnd(58)} ${r.got.slice(0, 66)}`);
}
console.log(`  SELECTION_TESTS = ${pass}/${cases.length}`);
console.log(`  LLM_CALL_COUNT = ${selectResource(resources(), request(), policyByRef).llm_calls}`);
if (pass !== cases.length) process.exit(1);
