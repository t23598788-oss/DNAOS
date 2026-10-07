/**
 * หน้าที่: ขอบเขตสาธารณะของ infrastructure-billing
 *
 * capability นี้ **อ่านอย่างเดียว** โดยการออกแบบ: ไม่มี export ตัวไหนที่จ่ายเงิน
 * เปลี่ยนแพ็กเกจ หรือปิด resource ได้ ผู้ที่เรียกใช้จึงไปถึงการใช้จ่ายไม่ได้
 * แม้จะพยายาม
 *
 * Output: collector, normalizer, cost engine, anomaly, persistence, types
 * Dependency ที่อนุญาต: ./*.ts
 * สิ่งที่ห้ามแตะ: ห้าม export อะไรที่ทำให้เกิดภาระผูกพันทางการเงิน
 */

/**
 * แหล่งความจริงกลางของต้นทุนสำหรับหน้าจอ — Owner ล็อกไว้ 2026-08-27
 * frontend เรียกตัวนี้ตัวเดียวและแสดงผลอย่างเดียว ห้ามคำนวณเงินซ้ำ
 */
export { costOverview } from "./read-model";
export type { CostOverview } from "./read-model";

export { collectVercel, VERCEL_CHANNELS } from "./connectors/vercel";
export type { VercelCollection, ChannelStatus } from "./connectors/vercel";

export { summarize, reconcile, buildBaseline, deltaPercent, formatMinor, periodDays, elapsedDays, groupBy, isFixed } from "./cost-engine";
export type { Reconciliation } from "./cost-engine";

export { detectAnomalies, ownerMessage, DEFAULT_THRESHOLDS } from "./anomaly";

export {
  persistBillingRecords, loadBillingRecords, persistAnomaly, loadAnomalies,
  persistBaselineSample, loadBaselineSamples, lineageFor,
} from "./persistence";

export type {
  BillingRecord, CostSummary, CostBaseline, CostClassification, CostLineage,
  BillingAnomaly, BillingAnomalyType, AnomalyThresholds, Provider, EvidenceChannel,
} from "./types";
