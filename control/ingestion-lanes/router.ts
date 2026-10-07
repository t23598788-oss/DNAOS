/**
 * หน้าที่: ตัวจัดเส้นทางที่กำหนดผลได้ จากผลการจำแนกไปยัง lane และ command
 *
 * Owner, 2026-09-05 ข้อ 14/19: ตัวจำแนกเสนอได้อย่างเดียว การตัดสินว่าไปทางไหน
 * ต้องมาจากนโยบายที่เขียนไว้ และ **ห้ามมีค่าปริยายเป็นงานขาย**
 * ถ้าความมั่นใจต่ำ โดเมนขัดกัน หรือบริบทไม่ครบ ต้องเป็น NEEDS_RESOLUTION
 * ไม่ใช่เดาแล้วเขียนสถานะธุรกิจลงไป
 *
 * Input: RAW_OBSERVATION + CONTEXT_ENVELOPE + CLASSIFICATION_RESULT
 * Output: ROUTING_DECISION_V1
 * Dependency ที่อนุญาต: ./types.ts + data/*.json
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มกฎที่ทำให้โดเมนใดเป็นค่าปริยาย
 * - ห้ามให้ไฟล์นี้เขียนข้อมูลใด ๆ มันคืนการตัดสินใจอย่างเดียว
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BusinessDomain, BusinessLaneV1, ClassificationResultV1, ContextEnvelopeV1,
  IntentSpec, RoutingDecisionV1,
} from "./types";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "data");
const load = <T>(f: string): T[] => JSON.parse(readFileSync(join(DATA, f), "utf-8"));

export const intents = (): readonly IntentSpec[] => load<IntentSpec>("intents.json");
export const lanes = (): readonly BusinessLaneV1[] => load<BusinessLaneV1>("lanes.json");

export const intentById = (id: string): IntentSpec | null => intents().find((i) => i.intent_id === id) ?? null;
export const laneForDomain = (d: BusinessDomain): BusinessLaneV1 | null => lanes().find((l) => l.domain === d) ?? null;

/** โดเมนที่เขียนสถานะทางการเงินหรือสิทธิ์ ต้องมั่นใจสูงกว่าปกติ */
const HIGH_STAKES: ReadonlySet<BusinessDomain> = new Set(["FINANCE", "ACCOUNTING", "AUTHORIZATION"]);
const HIGH_STAKES_MIN_CONFIDENCE = 0.8;

export function route(
  observationId: string,
  context: ContextEnvelopeV1,
  classification: ClassificationResultV1,
): RoutingDecisionV1 {
  const rejected: { domain: BusinessDomain; reason: string }[] = [];
  const selected: BusinessDomain[] = [];
  const commands: string[] = [];
  const acceptedIntents: string[] = [];
  const reasons: string[] = [];
  let needsHuman = false;

  const candidateDomains = classification.domains.map((d) => d.domain);

  for (const cand of classification.domains) {
    const lane = laneForDomain(cand.domain);
    if (lane === null) { rejected.push({ domain: cand.domain, reason: "ไม่มี lane ที่รับโดเมนนี้" }); continue; }

    // เจตนาที่เสนอมา ต้องเป็นเจตนาที่ lane นี้รับ
    const laneIntents = classification.candidate_intents
      .map((c) => ({ spec: intentById(c.intent_id), confidence: c.confidence }))
      .filter((x): x is { spec: IntentSpec; confidence: number } => x.spec !== null)
      .filter((x) => x.spec.domain === cand.domain && lane.accepted_intents.includes(x.spec.intent_id));

    if (laneIntents.length === 0) {
      rejected.push({ domain: cand.domain, reason: "ไม่มีเจตนาที่ lane นี้รับอยู่ในรายการที่เสนอมา" });
      continue;
    }

    for (const { spec, confidence } of laneIntents) {
      const floor = HIGH_STAKES.has(cand.domain)
        ? Math.max(spec.min_confidence, HIGH_STAKES_MIN_CONFIDENCE)
        : spec.min_confidence;
      if (confidence < floor) {
        rejected.push({ domain: cand.domain, reason: `ความมั่นใจ ${confidence} ต่ำกว่าเกณฑ์ ${floor} ของ ${spec.intent_id}` });
        needsHuman = true;
        continue;
      }
      const missingContext = spec.required_context.filter((k) => {
        const v = (context as unknown as Record<string, unknown>)[k];
        return v === null || v === undefined || v === "";
      });
      if (missingContext.length > 0) {
        rejected.push({ domain: cand.domain, reason: `บริบทไม่ครบสำหรับ ${spec.intent_id}: ${missingContext.join(", ")}` });
        needsHuman = true;
        continue;
      }
      if (!selected.includes(cand.domain)) selected.push(cand.domain);
      acceptedIntents.push(spec.intent_id);
      if (spec.canonical_command !== null && !commands.includes(spec.canonical_command)) {
        // §4: command คือคำขอให้เกิด ไม่ใช่ข้อเท็จจริงที่เกิดแล้ว
        // เหตุการณ์ (spec.emits_domain_event) จะเกิดหลังตัวจัดการยืนยันเท่านั้น
        commands.push(spec.canonical_command);
      }
      reasons.push(`${cand.domain}: ${spec.intent_id} (${spec.kind}) ผ่านเกณฑ์ ${floor}`);
    }
  }

  if (classification.ambiguity.length > 0) needsHuman = true;

  /**
   * §14/§19: ไม่มีทางลัดไปงานขาย ถ้าไม่มีโดเมนใดผ่านเกณฑ์
   * ผลคือการบันทึกข้อสังเกตไว้เฉย ๆ หรือขอให้คนช่วยตัด ไม่ใช่เดาว่าเป็นการขาย
   */
  const generalOnly = selected.length === 1 && selected[0] === "GENERAL_CONVERSATION";
  const outcome: RoutingDecisionV1["outcome"] =
    selected.length === 0 ? (needsHuman ? "NEEDS_RESOLUTION" : "OBSERVATION_ONLY")
      : needsHuman && !generalOnly ? "NEEDS_RESOLUTION"
      : "ROUTED";

  const confidences = classification.domains
    .filter((d) => selected.includes(d.domain)).map((d) => d.confidence);

  return {
    schema: "ROUTING_DECISION_V1",
    observation_id: observationId,
    candidate_domains: candidateDomains,
    selected_domains: selected,
    candidate_intents: classification.candidate_intents.map((c) => c.intent_id),
    resolved_command_ids: outcome === "ROUTED" ? commands : [],
    rejected_domains: rejected,
    reason: reasons.join(" · ") || "ไม่มีโดเมนใดผ่านเกณฑ์ จึงเก็บไว้เป็นข้อสังเกตอย่างเดียว",
    evidence_refs: classification.domains.flatMap((d) => d.evidence),
    resolver_type: "DETERMINISTIC_POLICY",
    confidence: confidences.length > 0 ? Math.min(...confidences) : 0,
    requires_human_resolution: outcome === "NEEDS_RESOLUTION",
    outcome,
  };
}
