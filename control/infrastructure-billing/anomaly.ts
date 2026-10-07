/**
 * หน้าที่: เทียบของจริงกับ baseline แล้วบอกว่าอะไรผิดปกติ
 *
 * threshold ทุกตัวมาจาก config ที่ส่งเข้ามา ไม่มีตัวเลขฝังในโค้ด — ค่าเริ่มต้น
 * ประกาศไว้ที่เดียวและอ่านได้ ถ้าใครอยากเข้มขึ้นก็ส่งค่าใหม่เข้ามา
 *
 * ทุก anomaly ต้องพก evidence_ref และตอบได้ว่า "ต้องให้ Owner ตัดสินใจไหม"
 * เรื่องเงินใหม่ = ต้องเสมอ
 *
 * Input: BillingRecord[], CostBaseline, AnomalyThresholds
 * Output: `detectAnomalies`, `DEFAULT_THRESHOLDS`
 * Dependency ที่อนุญาต: ./types.ts, ./cost-engine.ts, node:crypto
 * สิ่งที่ห้ามแตะ: ห้ามจ่ายเงิน ห้าม upgrade ห้ามปิด resource — โมดูลนี้
 * รายงานอย่างเดียว
 */

import { randomUUID } from "node:crypto";
import type { AnomalyThresholds, BillingAnomaly, BillingRecord, CostBaseline } from "./types";
import { deltaPercent, elapsedDays, formatMinor, summarize } from "./cost-engine";

/**
 * ค่าเริ่มต้น — เลือกไว้แบบอธิบายได้ ไม่ใช่ตัวเลขสวย ๆ
 *   1.5 เท่าต่อวัน: ผันผวนปกติของ usage อยู่ใต้ครึ่งเท่า
 *   1.3 เท่าต่อรอบ: ค่าคงที่ไม่ควรโตเกิน 30% ถ้าไม่มีใครไปกดเปิดอะไร
 *   2 sample: ตัดสินจากรอบเดียวคือการตัดสินจากความบังเอิญ
 */
export const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  daily_multiplier: 1.5,
  period_multiplier: 1.3,
  min_samples: 2,
};

export interface AnomalyInput {
  readonly records: readonly BillingRecord[];
  readonly baseline: CostBaseline;
  readonly thresholds?: AnomalyThresholds;
  readonly now?: string;
  /** สถานะการชำระเงินจาก provider ถ้าอ่านได้ */
  readonly payment_status?: string | null;
  readonly payment_evidence?: string | null;
}

export function detectAnomalies(input: AnomalyInput): readonly BillingAnomaly[] {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const now = input.now ?? new Date().toISOString();
  const out: BillingAnomaly[] = [];
  const { records, baseline } = input;
  if (records.length === 0) return out;

  const summary = summarize(records, { now });
  const currency = summary.currency;
  const account = records[0].account_id;
  const provider = records[0].provider;

  const enoughSamples = baseline.sample_count >= thresholds.min_samples;

  // ---- ยอดทั้งรอบโตผิดปกติ ----
  if (enoughSamples && baseline.normal_period_minor > 0) {
    const limit = Math.round(baseline.normal_period_minor * thresholds.period_multiplier);
    if (summary.current_period_minor > limit) {
      out.push({
        anomaly_id: `billing-anomaly-${randomUUID()}`,
        type: "BILLING_SPIKE",
        provider, account_id: account, project_id: null, resource: null,
        observed_minor: summary.current_period_minor,
        baseline_minor: baseline.normal_period_minor,
        delta_minor: summary.current_period_minor - baseline.normal_period_minor,
        delta_percent: deltaPercent(summary.current_period_minor, baseline.normal_period_minor),
        currency,
        threshold_used: `period_multiplier=${thresholds.period_multiplier} (baseline ${formatMinor(baseline.normal_period_minor, currency)} × ${thresholds.period_multiplier} = ${formatMinor(limit, currency)})`,
        first_seen_at: now,
        evidence_refs: [...new Set(records.map((r) => r.evidence_ref))].slice(0, 8),
        owner_decision_required: true,
        detail: `ยอดรอบนี้ ${formatMinor(summary.current_period_minor, currency)} เทียบ baseline ${formatMinor(baseline.normal_period_minor, currency)} จาก ${baseline.sample_count} รอบที่จ่ายสำเร็จจริง`,
      });
    }
  }

  // ---- ต่อวันโตผิดปกติ ----
  if (enoughSamples && baseline.normal_daily_minor > 0) {
    const limit = Math.round(baseline.normal_daily_minor * thresholds.daily_multiplier);
    if (summary.daily_average_minor > limit) {
      out.push({
        anomaly_id: `billing-anomaly-${randomUUID()}`,
        type: "RESOURCE_COST_SPIKE",
        provider, account_id: account, project_id: null, resource: null,
        observed_minor: summary.daily_average_minor,
        baseline_minor: baseline.normal_daily_minor,
        delta_minor: summary.daily_average_minor - baseline.normal_daily_minor,
        delta_percent: deltaPercent(summary.daily_average_minor, baseline.normal_daily_minor),
        currency,
        threshold_used: `daily_multiplier=${thresholds.daily_multiplier}`,
        first_seen_at: now,
        evidence_refs: [...new Set(records.map((r) => r.evidence_ref))].slice(0, 8),
        owner_decision_required: true,
        detail: `เฉลี่ยวันละ ${formatMinor(summary.daily_average_minor, currency)} เทียบปกติ ${formatMinor(baseline.normal_daily_minor, currency)} (ผ่านมา ${summary.elapsed_days}/${summary.period_days} วัน)`,
      });
    }
  }

  // ---- resource ตัวไหนโตผิดปกติ ----
  // เทียบ resource กับยอดรวมของ baseline ทั้งรอบ: ถ้า resource เดียวกินเกิน
  // ยอดปกติทั้งรอบ แปลว่ามันคือของใหม่ที่เพิ่งโผล่ ไม่ใช่ความผันผวน
  if (enoughSamples && baseline.normal_period_minor > 0) {
    for (const [resource, amount] of Object.entries(summary.by_resource)) {
      if (resource === "UNSPECIFIED") continue;
      if (amount <= baseline.normal_period_minor) continue;
      const owning = records.filter((r) => (r.resource ?? "UNSPECIFIED") === resource);
      out.push({
        anomaly_id: `billing-anomaly-${randomUUID()}`,
        type: "RESOURCE_COST_SPIKE",
        provider, account_id: account,
        project_id: owning[0]?.project_id ?? null,
        resource,
        observed_minor: amount,
        baseline_minor: baseline.normal_period_minor,
        delta_minor: amount - baseline.normal_period_minor,
        delta_percent: deltaPercent(amount, baseline.normal_period_minor),
        currency,
        threshold_used: "resource เดียวเกินยอดปกติทั้งรอบ",
        first_seen_at: owning[0]?.observed_at ?? now,
        evidence_refs: [...new Set(owning.map((r) => r.evidence_ref))],
        owner_decision_required: true,
        detail: `"${resource}" คิดเป็น ${formatMinor(amount, currency)} ซึ่งมากกว่าค่าใช้จ่ายปกติทั้งรอบ (${formatMinor(baseline.normal_period_minor, currency)})`,
      });
    }
  }

  // ---- การชำระเงินล้มเหลว / เสี่ยงถูกระงับ ----
  if (input.payment_status && /overdue|failed|past_due|unpaid/i.test(input.payment_status)) {
    out.push({
      anomaly_id: `billing-anomaly-${randomUUID()}`,
      type: "PAYMENT_FAILED",
      provider, account_id: account, project_id: null, resource: null,
      observed_minor: summary.current_period_minor,
      baseline_minor: baseline.normal_period_minor,
      delta_minor: summary.current_period_minor - baseline.normal_period_minor,
      delta_percent: deltaPercent(summary.current_period_minor, baseline.normal_period_minor),
      currency,
      threshold_used: `provider รายงานสถานะ "${input.payment_status}"`,
      first_seen_at: now,
      evidence_refs: [input.payment_evidence ?? `${provider}:billing.status`],
      owner_decision_required: true,
      detail: `สถานะการชำระเงินของบัญชีคือ "${input.payment_status}" — ต้องใช้เงินใหม่ ระบบไม่จ่ายเอง`,
    });
    out.push({
      anomaly_id: `billing-anomaly-${randomUUID()}`,
      type: "SUSPENSION_RISK",
      provider, account_id: account, project_id: null, resource: null,
      observed_minor: summary.current_period_minor,
      baseline_minor: baseline.normal_period_minor,
      delta_minor: 0,
      delta_percent: 0,
      currency,
      threshold_used: "สถานะค้างชำระ = มีความเสี่ยงถูกระงับบริการ",
      first_seen_at: now,
      evidence_refs: [input.payment_evidence ?? `${provider}:billing.status`],
      owner_decision_required: true,
      detail: "บัญชีค้างชำระ ผู้ให้บริการอาจระงับ deployment",
    });
  }

  return out;
}

/** ข้อความแจ้ง Owner — บอกครบว่าเกิดอะไร เท่าไร เพราะอะไร ต้องตัดสินใจอะไร */
export function ownerMessage(anomaly: BillingAnomaly): string {
  const lines = [
    `[${anomaly.type}] ${anomaly.provider}`,
    `ยอดที่พบ: ${formatMinor(anomaly.observed_minor, anomaly.currency)}`,
    `ปกติ: ${formatMinor(anomaly.baseline_minor, anomaly.currency)}  (ต่าง ${anomaly.delta_percent > 0 ? "+" : ""}${anomaly.delta_percent}%)`,
  ];
  if (anomaly.resource) lines.push(`resource: ${anomaly.resource}`);
  if (anomaly.project_id) lines.push(`project: ${anomaly.project_id}`);
  lines.push(`เกณฑ์: ${anomaly.threshold_used}`);
  lines.push(`หลักฐาน: ${anomaly.evidence_refs.slice(0, 3).join(", ")}`);
  lines.push(anomaly.owner_decision_required
    ? "ต้องให้ Owner ตัดสินใจ — ระบบไม่จ่าย ไม่ upgrade และไม่ปิด resource เอง"
    : "ไม่ต้องตัดสินใจอะไร");
  return lines.join("\n");
}
