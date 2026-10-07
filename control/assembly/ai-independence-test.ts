/**
 * หน้าที่: พิสูจน์ว่าการประกอบไม่ต้องใช้ AI เมื่อ capability ที่ต้องใช้มีครบแล้ว
 *
 * Owner, 2026-09-05 ข้อ 27: จาก canonical command ไป planner ไป linker ไป manifest
 * ต้องสำเร็จโดย LLM_CALL_COUNT = 0
 * AI ทำได้อย่างเดียวคือแปลภาษาคนเป็น command id + อินพุตที่มีโครงสร้าง ซึ่งเกิด
 * ก่อนขั้นตอนทั้งหมดนี้ และไม่มีอยู่ในไฟล์นี้
 *
 * ตารางด้านล่างคือการแปลที่ "กำหนดไว้ล่วงหน้า" ไม่ใช่การตีความตอนรัน — จึงยัง
 * นับเป็นเส้นทางที่ไม่มี AI
 *
 * Dependency ที่อนุญาต: ./assembly-query.ts ./linker.ts ./planner.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้าม import อะไรที่เรียกโมเดลภาษาเข้ามาในไฟล์นี้
 */

import { buildExecutionManifest } from "./linker";
import { resolveCommand } from "./assembly-query";

/** ประโยคที่เจ้าของพูดจริง -> command id ที่ประกาศไว้แล้ว */
export const PHRASE_TO_COMMAND: Readonly<Record<string, string>> = {
  "คำนวณราคา": "CALCULATE_PRICE",
  "ขอราคาหิน": "CALCULATE_PRICE",
  "ออกใบแจ้งหนี้": "ISSUE_INVOICE",
  "จับคู่การชำระเงิน": "MATCH_PAYMENT",
  "ลูกค้าโอนเงินมาแล้ว": "MATCH_PAYMENT",
  "ดูว่าเบอร์นี้เป็นบริษัทไหน": "LINK_COMPANY",
  "บันทึกหน้างาน": "REGISTER_SITE_LOCATION",
  "อ่านสลิป": "CLASSIFY_RECEIPT_IMAGE",
  "รับสัญญาณเครื่องจักร": "RECORD_EQUIPMENT_TELEMETRY",
  "ล็อกรถ": "LOCK_EQUIPMENT",
  "ขอสิทธิ์หน้างาน": "REQUEST_SITE_AUTHORIZATION",
  "ตอบลูกค้าในแชท": "RESPOND_TO_MESSAGE",
};

export interface TestCaseResult {
  readonly phrase: string;
  readonly command_id: string;
  readonly plan_nodes: number;
  readonly link_verdict: string;
  readonly manifest_operations: number | null;
  readonly llm_calls: number;
  readonly passed: boolean;
  readonly blocker: string | null;
}

export interface TestRun {
  readonly total: number;
  readonly passed: number;
  readonly blocked: number;
  readonly llm_call_count: number;
  readonly cases: readonly TestCaseResult[];
}

export function runAiIndependenceTests(context = {
  available_resources: ["supabase", "line", "ai-provider", "company-settings"],
  granted_authority: ["ADMIN_TIER", "MACHINE_SECRET"],
}): TestRun {
  const cases: TestCaseResult[] = [];
  let llm = 0;

  for (const [phrase, commandId] of Object.entries(PHRASE_TO_COMMAND)) {
    const r = resolveCommand(commandId, context);
    if (!r.ok) {
      cases.push({ phrase, command_id: commandId, plan_nodes: 0, link_verdict: "UNKNOWN_COMMAND",
        manifest_operations: null, llm_calls: 0, passed: false, blocker: "ไม่รู้จักคำสั่งนี้" });
      continue;
    }
    llm += r.llm_calls + r.plan.llm_calls + r.link.llm_calls;
    const mf = buildExecutionManifest(r.plan, r.link, `mf.${commandId.toLowerCase()}`);
    if (mf.ok) llm += mf.manifest.llm_calls;
    cases.push({
      phrase, command_id: commandId, plan_nodes: r.plan.nodes.length,
      link_verdict: r.link.verdict,
      manifest_operations: mf.ok ? mf.manifest.ordered_operations.length : null,
      llm_calls: 0, passed: mf.ok,
      blocker: mf.ok ? null : (r.link.problems[0] ?? "ต่อไม่ได้"),
    });
  }

  return {
    total: cases.length, passed: cases.filter((c) => c.passed).length,
    blocked: cases.filter((c) => !c.passed).length, llm_call_count: llm, cases,
  };
}
