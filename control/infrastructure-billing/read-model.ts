/**
 * หน้าที่: คำตอบสำเร็จรูปสำหรับหน้าจอ — frontend เอาไปแสดงได้เลย
 *
 * **นี่คือแหล่งความจริงกลางของต้นทุน** (Owner ล็อกไว้ 2026-08-27)
 * หน้าจอห้ามคำนวณเงินซ้ำ ไม่ว่าจะบวก ลบ เฉลี่ย หรือพยากรณ์ — ทุกตัวเลขที่
 * ผู้ใช้เห็นต้องมาจากที่นี่ที่เดียว เพราะเลขสองชุดที่คำนวณคนละที่จะไม่ตรงกัน
 * สักวัน แล้วจะไม่มีใครรู้ว่าชุดไหนถูก
 *
 * ทุก field เป็นค่าที่แสดงได้ทันที: มีทั้งตัวเลขดิบ (หน่วยย่อย) สำหรับการ
 * เรียงลำดับ และข้อความจัดรูปแล้วสำหรับแสดงผล frontend จึงไม่มีเหตุผลต้อง
 * แตะเลขคณิตเลย
 *
 * Input: provider + account
 * Output: `costOverview`
 * Dependency ที่อนุญาต: ./cost-engine.ts, ./anomaly.ts, ./persistence.ts, ./types.ts
 * สิ่งที่ห้ามแตะ: ห้ามคืนข้อมูลดิบที่บังคับให้ผู้เรียกต้องคำนวณต่อ ถ้า
 * หน้าจอต้องบวกเลขเอง แปลว่า read model นี้ยังทำหน้าที่ไม่ครบ
 */

import type { BillingAnomaly, BillingRecord, CostBaseline, CostSummary, Provider } from "./types";
import { buildBaseline, deltaPercent, formatMinor, summarize } from "./cost-engine";
import { detectAnomalies, DEFAULT_THRESHOLDS } from "./anomaly";
import { loadAnomalies, loadBaselineSamples, loadBillingRecords } from "./persistence";

export interface CostOverview {
  readonly provider: Provider;
  readonly account_id: string;
  readonly currency: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly elapsed_days: number;
  readonly period_days: number;

  /** ยอดรอบนี้ — ทั้งเลขดิบและข้อความพร้อมแสดง */
  readonly current_bill_minor: number;
  readonly current_bill: string;
  readonly today_minor: number;
  readonly today: string;
  readonly daily_average_minor: number;
  readonly daily_average: string;

  readonly baseline_minor: number;
  readonly baseline: string;
  readonly baseline_sample_count: number;
  readonly delta_minor: number;
  readonly delta: string;
  readonly delta_percent: number;

  readonly forecast_minor: number;
  readonly forecast: string;

  /** resource ที่กินเงินมากที่สุด พร้อมหลักฐาน */
  readonly top_cost_driver: {
    readonly resource: string;
    readonly service: string;
    readonly amount_minor: number;
    readonly amount: string;
    readonly share_percent: number;
    readonly evidence_ref: string;
  } | null;

  readonly by_classification: Readonly<Record<string, { readonly amount_minor: number; readonly amount: string }>>;
  readonly breakdown: readonly {
    readonly service: string;
    readonly resource: string | null;
    readonly amount_minor: number;
    readonly amount: string;
    readonly classification: string;
    readonly derived: boolean;
    readonly evidence_ref: string;
  }[];

  readonly anomalies: readonly {
    readonly type: string;
    readonly headline: string;
    readonly observed: string;
    readonly baseline: string;
    readonly delta_percent: number;
    readonly resource: string | null;
    readonly owner_decision_required: boolean;
    readonly evidence_refs: readonly string[];
  }[];

  readonly payment_status: string | null;
  readonly unresolved_count: number;
  readonly evidence_ref: string;
  readonly computed_at: string;
  /** ประกาศไว้ให้หน้าจออ่านได้ว่าใครเป็นคนคำนวณ */
  readonly computed_by: string;
}

const SOURCE = "control/infrastructure-billing/read-model.ts";

/**
 * คำตอบเดียวที่หน้าจอต้องใช้
 *
 * รับ record มาตรง ๆ ได้ (เช่นเพิ่งเก็บมาสด) หรือให้มันอ่านจาก evidence store
 * เองก็ได้ ผลลัพธ์เหมือนกันเพราะคำนวณด้วย engine ตัวเดียวกัน
 */
export function costOverview(input: {
  readonly provider: Provider;
  readonly account_id: string;
  readonly period_start: string;
  readonly records?: readonly BillingRecord[];
  readonly baseline?: CostBaseline;
  readonly anomalies?: readonly BillingAnomaly[];
  readonly payment_status?: string | null;
  readonly now?: string;
}): CostOverview {
  const now = input.now ?? new Date().toISOString();
  const records = input.records ?? loadBillingRecords(input.provider, input.account_id, input.period_start);
  const summary: CostSummary = summarize(records, { now });

  const baseline = input.baseline ?? buildBaseline({
    provider: input.provider,
    account_id: input.account_id,
    currency: summary.currency,
    samples: loadBaselineSamples(input.provider, input.account_id),
  });

  const anomalies = input.anomalies ?? (
    records.length > 0
      ? detectAnomalies({ records, baseline, thresholds: DEFAULT_THRESHOLDS, now, payment_status: input.payment_status ?? null })
      : loadAnomalies(input.provider, input.account_id)
  );

  // resource ที่กินเงินมากที่สุด — ตัดสินจากยอดจริง ไม่ใช่ความเห็น
  const charged = records.filter((r) => r.amount_minor > 0);
  const top = charged.length === 0 ? null : charged.reduce((a, b) => (b.amount_minor > a.amount_minor ? b : a));

  const money = (minor: number): string => formatMinor(minor, summary.currency);

  const byClassification: Record<string, { amount_minor: number; amount: string }> = {};
  for (const [key, value] of Object.entries(summary.by_classification)) {
    byClassification[key] = { amount_minor: value, amount: money(value) };
  }

  return {
    provider: input.provider,
    account_id: input.account_id,
    currency: summary.currency,
    period_start: summary.period_start,
    period_end: summary.period_end,
    elapsed_days: summary.elapsed_days,
    period_days: summary.period_days,

    current_bill_minor: summary.current_period_minor,
    current_bill: money(summary.current_period_minor),
    today_minor: summary.today_minor,
    today: money(summary.today_minor),
    daily_average_minor: summary.daily_average_minor,
    daily_average: money(summary.daily_average_minor),

    baseline_minor: baseline.normal_period_minor,
    baseline: money(baseline.normal_period_minor),
    baseline_sample_count: baseline.sample_count,
    delta_minor: summary.current_period_minor - baseline.normal_period_minor,
    delta: money(summary.current_period_minor - baseline.normal_period_minor),
    delta_percent: deltaPercent(summary.current_period_minor, baseline.normal_period_minor),

    forecast_minor: summary.estimated_end_of_period_minor,
    forecast: money(summary.estimated_end_of_period_minor),

    top_cost_driver: top === null ? null : {
      resource: top.resource ?? top.service,
      service: top.service,
      amount_minor: top.amount_minor,
      amount: money(top.amount_minor),
      share_percent: summary.current_period_minor === 0 ? 0
        : Math.round((top.amount_minor / summary.current_period_minor) * 1000) / 10,
      evidence_ref: top.evidence_ref,
    },

    by_classification: byClassification,
    breakdown: [...records]
      .sort((a, b) => b.amount_minor - a.amount_minor)
      .map((r) => ({
        service: r.service,
        resource: r.resource,
        amount_minor: r.amount_minor,
        amount: money(r.amount_minor),
        classification: r.classification,
        derived: r.derived,
        evidence_ref: r.evidence_ref,
      })),

    anomalies: anomalies.map((a) => ({
      type: a.type,
      headline: a.detail,
      observed: money(a.observed_minor),
      baseline: money(a.baseline_minor),
      delta_percent: a.delta_percent,
      resource: a.resource,
      owner_decision_required: a.owner_decision_required,
      evidence_refs: a.evidence_refs,
    })),

    payment_status: input.payment_status ?? null,
    unresolved_count: summary.unresolved_count,
    evidence_ref: `billing:${input.provider}:${input.account_id}:${input.period_start.slice(0, 10)}`,
    computed_at: now,
    computed_by: SOURCE,
  };
}
