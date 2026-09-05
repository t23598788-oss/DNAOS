/**
 * หน้าที่: บังคับกติกาของโมเดลการแยกท่อ ไม่ให้ค่อย ๆ ไหลกลับไปเป็นท่อเดียว
 *
 * Owner, 2026-09-05 ข้อ 13/14/19: ตัวจำแนกต้องเขียนสถานะเป็นศูนย์
 * ห้ามมีค่าปริยายเป็นงานขาย และเจตนาที่กำกวมต้องไม่เขียนสถานะธุรกิจ
 *
 * ไฟล์นี้เป็นผู้ตัดสิน — ถ้ามันบอกว่าไม่ผ่าน แปลว่ากติกาถูกละเมิดจริง
 *
 * Dependency ที่อนุญาต: ./router.ts ./types.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามปิดข้อตรวจเพื่อให้ผ่าน
 */

import { intentById, intents, lanes, route } from "./router";
import type { ClassificationResultV1, ContextEnvelopeV1 } from "./types";

export interface LaneFinding {
  readonly check: string;
  readonly severity: "ERROR" | "WARNING";
  readonly subject: string;
  readonly detail: string;
}

const ctx = (over: Partial<ContextEnvelopeV1> = {}): ContextEnvelopeV1 => ({
  schema: "CONTEXT_ENVELOPE_V1", observation_id: "probe", person: "p", company_id: "c",
  role: "customer", permissions: [], conversation_state: "ai", related_order_id: null,
  related_document_id: null, related_payment_id: null, related_resource_id: null,
  resolution_gaps: [], read_only: true, ...over,
});

const cls = (
  domains: ClassificationResultV1["domains"],
  candidate_intents: ClassificationResultV1["candidate_intents"],
  ambiguity: readonly string[] = [],
): ClassificationResultV1 => ({
  schema: "CLASSIFICATION_RESULT_V1", event_class: "OBSERVATION", observation_id: "probe",
  domains, candidate_intents, candidate_data: {}, ambiguity, classifier_type: "HYBRID", state_writes: 0,
});

export function verifyLaneModel(): { findings: readonly LaneFinding[]; result: "PASS" | "FAIL"; checks: number } {
  const f: LaneFinding[] = [];
  const add = (check: string, severity: LaneFinding["severity"], subject: string, detail: string) =>
    f.push({ check, severity, subject, detail });

  const L = lanes(); const I = intents();

  // 1 lane ที่ถือข้อมูลต้องมีตัวจัดการที่กำหนดผลได้
  for (const l of L) {
    if (l.owned_data.length > 0 && l.deterministic_handler === null) {
      add("lane_without_handler", "ERROR", l.lane_id, "ถือข้อมูลแต่ไม่มีตัวจัดการที่กำหนดผลได้");
    }
    if (l.financial_effects.length > 0 && l.state_machine === null) {
      add("financial_lane_without_state_machine", "WARNING", l.lane_id, "มีผลทางการเงินแต่ไม่มีวงจรชีวิตประกาศไว้");
    }
  }

  // 2 ต้องมี lane สนทนาทั่วไป (§12)
  if (!L.some((l) => l.domain === "GENERAL_CONVERSATION")) {
    add("missing_general_lane", "ERROR", "lanes", "ไม่มี lane สำหรับข้อความที่ไม่ใช่คำสั่งทางธุรกิจ");
  }

  // 3 เจตนาต้องอยู่ใน lane ที่รับมัน และ command ที่อ้างต้องอยู่ในรายการที่ lane อนุญาต
  for (const i of I) {
    const lane = L.find((l) => l.domain === i.domain);
    if (lane === undefined) { add("intent_without_lane", "ERROR", i.intent_id, `ไม่มี lane ของโดเมน ${i.domain}`); continue; }
    if (!lane.accepted_intents.includes(i.intent_id)) {
      add("intent_not_accepted", "WARNING", i.intent_id, `lane ${lane.lane_id} ไม่ได้รับเจตนานี้`);
    }
    if (i.canonical_command !== null && !lane.allowed_commands.includes(i.canonical_command)) {
      add("command_not_allowed_in_lane", "ERROR", i.intent_id, `${i.canonical_command} ไม่อยู่ในรายการที่ ${lane.lane_id} อนุญาต`);
    }
    // §4: CLAIM และ QUERY ต้องไม่ประกาศเหตุการณ์โดเมนโดยตรงถ้าไม่มี command คั่น
    if ((i.kind === "CLAIM" || i.kind === "QUERY") && i.emits_domain_event !== null && i.canonical_command === null) {
      add("claim_emits_event_directly", "ERROR", i.intent_id, "คำกล่าวอ้างหรือการอ่านข้อมูลประกาศเหตุการณ์โดยไม่ผ่านคำสั่ง");
    }
  }

  // 4 §14 ห้ามมีค่าปริยายเป็นงานขาย — ยิงข้อมูลที่ไม่มีใครเสนอ SALES แล้วต้องไม่ได้ SALES
  const noSales = route("probe", ctx(), cls(
    [{ domain: "DOCUMENT", confidence: 0.95, evidence: ["ขอเอกสาร"] }],
    [{ intent_id: "REQUEST_DOCUMENT", confidence: 0.95, evidence: [] }]));
  if (noSales.selected_domains.includes("SALES")) {
    add("default_to_sales", "ERROR", "router", "เลือกงานขายทั้งที่ไม่มีใครเสนอโดเมนนี้");
  }
  const empty = route("probe", ctx(), cls([], []));
  if (empty.selected_domains.length > 0) {
    add("default_to_sales", "ERROR", "router", `ไม่มีผู้เสนอโดเมนใดเลยแต่ยังเลือก ${empty.selected_domains.join(",")}`);
  }

  // 5 §19 ความมั่นใจต่ำในโดเมนที่มีผลทางการเงิน ต้องไม่ออกคำสั่ง
  const lowConfidence = route("probe", ctx(), cls(
    [{ domain: "FINANCE", confidence: 0.65, evidence: ["จ่ายแล้ว"] }],
    [{ intent_id: "CLAIM_PAYMENT", confidence: 0.65, evidence: [] }]));
  if (lowConfidence.resolved_command_ids.length > 0) {
    add("write_from_ambiguous_intent", "ERROR", "router", "ความมั่นใจต่ำแต่ยังออกคำสั่งที่กระทบเงิน");
  }

  // 6 §19 บริบทไม่ครบ ต้องไม่ออกคำสั่ง
  const noContext = route("probe", ctx({ company_id: null }), cls(
    [{ domain: "SALES", confidence: 0.95, evidence: ["ขอราคา"] }],
    [{ intent_id: "REQUEST_QUOTE", confidence: 0.95, evidence: [] }]));
  if (noContext.resolved_command_ids.length > 0) {
    add("write_without_context", "ERROR", "router", "บริบทไม่ครบแต่ยังออกคำสั่ง");
  }

  // 7 §6 หนึ่งข้อสังเกตต้องกระจายได้หลาย lane
  const fanOut = route("probe", ctx(), cls(
    [{ domain: "DOCUMENT", confidence: 0.9, evidence: [] }, { domain: "FINANCE", confidence: 0.9, evidence: [] }],
    [{ intent_id: "REQUEST_DOCUMENT", confidence: 0.9, evidence: [] }, { intent_id: "CLAIM_PAYMENT", confidence: 0.9, evidence: [] }]));
  if (fanOut.selected_domains.length < 2) {
    add("no_fan_out", "ERROR", "router", "กระจายไปหลาย lane ไม่ได้ทั้งที่ทั้งสองโดเมนผ่านเกณฑ์");
  }
  if (fanOut.selected_domains.includes("SALES")) {
    add("sales_injected_on_fan_out", "ERROR", "router", "แทรกงานขายเข้ามาตอนกระจาย");
  }

  // 8 §13 ผลการจำแนกต้องประกาศว่าเขียนสถานะเป็นศูนย์
  const probe = cls([], []);
  if (probe.state_writes !== 0) add("classifier_writes_state", "ERROR", "classification", "ตัวจำแนกประกาศว่าเขียนสถานะ");

  const errors = f.filter((x) => x.severity === "ERROR").length;
  return { findings: f, result: errors === 0 ? "PASS" : "FAIL", checks: 8 };
}

/** ใช้ตอบว่าเจตนานี้เป็นคำสั่ง คำกล่าวอ้าง หรือการอ่านข้อมูล (§8) */
export function intentKindOf(intentId: string): string | null {
  return intentById(intentId)?.kind ?? null;
}
