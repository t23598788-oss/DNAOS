/**
 * หน้าที่: ตัวตรวจจับที่ปฏิเสธไว้ก่อน — ไม่แน่ใจคือไม่ผ่าน
 *
 * Owner, 2026-09-05 ข้อ 22: ต้อง fail-closed ทุกตัว
 * ตัวตรวจเหล่านี้ใช้กับซอร์สและกับ contract ได้ โดยไม่ต้องรันของจริง
 *
 * Dependency ที่อนุญาต: ./quarantine.ts ./router.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ตัวตรวจตัวใดคืน "ผ่าน" เมื่อข้อมูลไม่พอตัดสิน
 */

import { readFileSync } from "node:fs";
import { classifyLegacyRow, type LegacyEventRow } from "./quarantine";

export interface DetectorResult {
  readonly detector: string;
  readonly verdict: "PASS" | "FAIL" | "INSUFFICIENT_EVIDENCE";
  readonly detail: string;
}

const read = (p: string): string => { try { return readFileSync(p, "utf-8"); } catch { return ""; } };

/** ตัวจำแนกเขียน canonical state ได้หรือไม่ — ดูจากซอร์สจริง */
export function detectClassifierDirectStateWrite(extractionFile: string): DetectorResult {
  const src = read(extractionFile);
  if (src === "") return { detector: "classifier_direct_state_write", verdict: "INSUFFICIENT_EVIDENCE", detail: `อ่านไฟล์ไม่ได้: ${extractionFile}` };
  const writes = /\.from\(\s*["'`]business_events["'`]\s*\)\s*[\s\S]{0,80}?\.(insert|update|upsert)\(/.test(src);
  return {
    detector: "classifier_direct_state_write",
    verdict: writes ? "FAIL" : "PASS",
    detail: writes ? "ไฟล์ตัวจำแนกยังเขียน business_events เอง" : "ไม่พบการเขียน business_events ในไฟล์ตัวจำแนก",
  };
}

/** คำกล่าวอ้างถูกบันทึกเป็นข้อเท็จจริงหรือไม่ */
export function detectClaimAsFact(rows: readonly LegacyEventRow[]): DetectorResult {
  if (rows.length === 0) return { detector: "claim_as_fact", verdict: "INSUFFICIENT_EVIDENCE", detail: "ยังไม่มีแถวให้ตรวจ" };
  const bad = rows.map(classifyLegacyRow).filter((r) => r.classification === "CLAIM_WRITTEN_AS_FACT");
  return { detector: "claim_as_fact", verdict: bad.length === 0 ? "PASS" : "FAIL",
    detail: bad.length === 0 ? "ไม่พบคำกล่าวอ้างที่ถูกบันทึกเป็นข้อเท็จจริง" : `พบ ${bad.length} แถว` };
}

/** ข้อความที่ไม่ใช่งานขายถูกเขียนเป็นเหตุการณ์งานขายหรือไม่ */
export function detectNonSalesIntoSales(rows: readonly LegacyEventRow[]): DetectorResult {
  if (rows.length === 0) return { detector: "non_sales_into_sales", verdict: "INSUFFICIENT_EVIDENCE", detail: "ยังไม่มีแถวให้ตรวจ" };
  const bad = rows.map(classifyLegacyRow).filter((r) =>
    r.classification === "MISROUTED_EVENT" || r.classification === "RAW_OBSERVATION_WRITTEN_AS_EVENT");
  return { detector: "non_sales_into_sales", verdict: bad.length === 0 ? "PASS" : "FAIL",
    detail: bad.length === 0 ? "ไม่พบข้อความที่ไม่ใช่งานขายถูกเขียนเป็นเหตุการณ์" : `พบ ${bad.length} แถว` };
}

/** เหตุการณ์ที่เกิดโดยไม่มีคำสั่งหรือแหล่งภายนอกรองรับ */
export function detectEventWithoutCommandOrExternalSource(
  channels: readonly { channel: string; message_class: string; producer: string }[],
): DetectorResult {
  const events = channels.filter((c) => c.message_class === "DOMAIN_EVENT");
  if (events.length === 0) return { detector: "event_without_command_or_external_source", verdict: "INSUFFICIENT_EVIDENCE", detail: "ไม่มีช่องทางเหตุการณ์ที่ประกาศไว้" };
  const commandProducers = new Set(channels.filter((c) => c.message_class === "COMMAND").flatMap((c) => [c.channel]));
  const orphan = events.filter((e) => !commandProducers.has(e.producer) && !e.producer.includes("lanes/"));
  return { detector: "event_without_command_or_external_source", verdict: orphan.length === 0 ? "PASS" : "FAIL",
    detail: orphan.length === 0 ? "ทุกเหตุการณ์มีตัวจัดการหรือแหล่งภายนอกรองรับ" : `ไม่มีที่มา: ${orphan.map((o) => o.channel).join(", ")}` };
}

/** transition ที่ไม่มีเจ้าของโค้ด */
export function detectStateTransitionWithoutOwner(
  machines: readonly { machine_id: string; transitions: readonly { from: string; to: string; implementation_owner: string | null }[] }[],
): DetectorResult {
  if (machines.length === 0) return { detector: "state_transition_without_owner", verdict: "INSUFFICIENT_EVIDENCE", detail: "ไม่มี state machine" };
  const orphan = machines.flatMap((m) => m.transitions.filter((t) => t.implementation_owner === null).map((t) => `${m.machine_id}#${t.from}->${t.to}`));
  return { detector: "state_transition_without_owner", verdict: orphan.length === 0 ? "PASS" : "FAIL",
    detail: orphan.length === 0 ? "ทุก transition มีเจ้าของโค้ด" : `ไม่มีเจ้าของ ${orphan.length}: ${orphan.slice(0, 4).join(", ")}` };
}

/** เหตุการณ์โดเมนที่ไม่มีตัวจัดการที่ตรวจแล้ว */
export function detectDomainEventWithoutVerifiedHandler(
  lanes: readonly { lane_id: string; output_events: readonly string[]; deterministic_handler: string | null }[],
): DetectorResult {
  const bad = lanes.filter((l) => l.output_events.length > 0 && l.deterministic_handler === null);
  return { detector: "domain_event_without_verified_handler", verdict: bad.length === 0 ? "PASS" : "FAIL",
    detail: bad.length === 0 ? "ทุก lane ที่ปล่อยเหตุการณ์มีตัวจัดการ" : `ขาดตัวจัดการ: ${bad.map((b) => b.lane_id).join(", ")}` };
}

/** สถานะทางการเงินที่ไม่มีที่มาของจำนวนเงิน */
export function detectFinancialStateWithoutAmountSource(
  effects: readonly { effect_id: string; amount_source: string; formula_ref: string }[],
): DetectorResult {
  if (effects.length === 0) return { detector: "financial_state_without_amount_source", verdict: "INSUFFICIENT_EVIDENCE", detail: "ไม่มีผลทางการเงินที่ประกาศไว้" };
  const bad = effects.filter((e) => e.amount_source.startsWith("UNKNOWN") || e.formula_ref === "");
  return { detector: "financial_state_without_amount_source", verdict: bad.length === 0 ? "PASS" : "FAIL",
    detail: bad.length === 0 ? "ทุกผลทางการเงินมีที่มาของจำนวนเงิน" : `ไม่มีที่มา: ${bad.map((b) => b.effect_id).join(", ")}` };
}
