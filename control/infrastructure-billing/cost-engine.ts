/**
 * หน้าที่: คำนวณต้นทุนจาก billing record — เลขคณิตล้วน ๆ
 *
 * ไม่มี AI ไม่มีการประมาณด้วยภาษา ไม่มีการปัดให้สวย ทุกตัวเลขเป็นจำนวนเต็ม
 * หน่วยย่อยของสกุลเงิน (เซนต์) บวกลบด้วยจำนวนเต็มตลอดทาง จึงไม่มีทางเพี้ยน
 * แบบ float และผลลัพธ์เดิมทุกครั้งที่คำนวณซ้ำ
 *
 * การพยากรณ์ปลายรอบเป็นสูตรตรง ๆ ที่เขียนไว้ให้อ่านได้ ไม่ใช่โมเดลทำนาย:
 *   ค่าคงที่ + (ค่าตามการใช้ ÷ วันที่ผ่านมา × วันทั้งรอบ)
 *
 * Input: BillingRecord[]
 * Output: `summarize`, `forecast`, `reconcile`, `groupBy`
 * Dependency ที่อนุญาต: ./types.ts
 * สิ่งที่ห้ามแตะ: ห้ามให้ AI หรือการเดาเข้ามาแตะตัวเลข และห้ามแก้ยอดให้ตรง
 * invoice ด้วยมือ — ถ้าไม่ตรงต้องรายงานว่าไม่ตรง
 */

import type { BillingRecord, CostBaseline, CostClassification, CostSummary } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** จำนวนวันของรอบ อย่างน้อย 1 เพื่อไม่ให้หารด้วยศูนย์ */
export function periodDays(startIso: string, endIso: string): number {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.max(1, Math.round((end - start) / DAY_MS));
}

export function elapsedDays(startIso: string, nowIso: string): number {
  const start = Date.parse(startIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(start) || !Number.isFinite(now) || now <= start) return 1;
  return Math.max(1, Math.round((now - start) / DAY_MS));
}

function addTo(map: Record<string, number>, key: string, amount: number): void {
  map[key] = (map[key] ?? 0) + amount;
}

/**
 * ค่าคงที่ = รายการที่ประกาศตัวเองว่าเหมาจ่ายรายเดือน/ราย seat
 *
 * ตัดสินจาก `usage_type` ไม่ใช่จาก "usage_quantity เป็น null" อย่างที่เขียน
 * ไว้ตอนแรก — เพราะยอด usage ที่แยกรายบรรทัดไม่ได้ก็มี quantity เป็น null
 * เหมือนกัน ทำให้มันถูกนับเป็นค่าคงที่และไม่ถูกขยายตอนพยากรณ์ ผลคือยอด
 * คาดการณ์ปลายรอบเท่ากับยอดปัจจุบันเป๊ะ ซึ่งเป็นไปไม่ได้เมื่อรอบยังไม่จบ
 */
export function isFixed(record: BillingRecord): boolean {
  if (record.usage_type === "fixed_monthly" || record.usage_type === "included_allocation") return true;
  return record.usage_unit === "month" || record.usage_unit === "seat";
}

export function summarize(
  records: readonly BillingRecord[],
  { now = new Date().toISOString(), periodStart, periodEnd }: { now?: string; periodStart?: string; periodEnd?: string } = {},
): CostSummary {
  const start = periodStart ?? records[0]?.period_start ?? now;
  const end = periodEnd ?? records[0]?.period_end ?? now;
  const currency = records[0]?.currency ?? "usd";

  const byProvider: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  const byService: Record<string, number> = {};
  const byResource: Record<string, number> = {};
  const byClassification: Record<CostClassification, number> = { REQUIRED: 0, WASTED: 0, ABNORMAL: 0, UNKNOWN: 0 };

  let total = 0;
  let todayTotal = 0;
  const today = now.slice(0, 10);

  for (const record of records) {
    total += record.amount_minor;
    addTo(byProvider, record.provider, record.amount_minor);
    addTo(byProject, record.project_id ?? "UNASSIGNED", record.amount_minor);
    addTo(byService, record.service, record.amount_minor);
    addTo(byResource, record.resource ?? "UNSPECIFIED", record.amount_minor);
    byClassification[record.classification] += record.amount_minor;
    // "วันนี้" นับเฉพาะรายการที่สังเกตเห็นวันนี้จริง ไม่ใช่การเฉลี่ยย้อนหลัง
    if (record.observed_at.slice(0, 10) === today && !isFixed(record)) todayTotal += record.amount_minor;
  }

  const days = periodDays(start, end);
  const elapsed = Math.min(days, elapsedDays(start, now));

  const fixedTotal = records.filter(isFixed).reduce((sum, r) => sum + r.amount_minor, 0);
  const variableTotal = total - fixedTotal;
  // พยากรณ์: ค่าคงที่คงเดิม + ค่าตามการใช้ขยายตามสัดส่วนวันที่เหลือ
  const projectedVariable = Math.round((variableTotal / elapsed) * days);

  return {
    currency,
    period_start: start,
    period_end: end,
    current_period_minor: total,
    today_minor: todayTotal,
    daily_average_minor: Math.round(total / elapsed),
    elapsed_days: elapsed,
    period_days: days,
    estimated_end_of_period_minor: fixedTotal + projectedVariable,
    by_provider: byProvider,
    by_project: byProject,
    by_service: byService,
    by_resource: byResource,
    by_classification: byClassification,
    record_count: records.length,
    unresolved_count: records.filter((r) => r.classification === "UNKNOWN" || r.derived).length,
  };
}

export interface Reconciliation {
  readonly calculated_minor: number;
  readonly invoice_minor: number;
  readonly difference_minor: number;
  readonly matches: boolean;
  readonly detail: string;
}

/**
 * เทียบยอดที่คำนวณได้กับยอดบน invoice จริง
 *
 * ไม่มีการปรับตัวเลขให้ตรงเด็ดขาด ถ้าไม่ตรงจะรายงานส่วนต่างออกไปตรง ๆ
 * เพราะยอดที่ถูกดัดให้ตรงคือยอดที่ไม่มีใครตรวจสอบได้อีกเลย
 */
export function reconcile(records: readonly BillingRecord[], invoiceMinor: number): Reconciliation {
  const calculated = records.reduce((sum, r) => sum + r.amount_minor, 0);
  const difference = calculated - invoiceMinor;
  return {
    calculated_minor: calculated,
    invoice_minor: invoiceMinor,
    difference_minor: difference,
    matches: difference === 0,
    detail: difference === 0
      ? `ยอดคำนวณตรงกับ invoice พอดี (${records.length} รายการ)`
      : `ยอดคำนวณต่างจาก invoice ${difference} หน่วยย่อย — รายงานตามจริง ไม่ปรับให้ตรง`,
  };
}

/** เปอร์เซ็นต์ที่โตขึ้นจาก baseline คำนวณด้วยจำนวนเต็ม ปัดหนึ่งตำแหน่ง */
export function deltaPercent(observedMinor: number, baselineMinor: number): number {
  if (baselineMinor === 0) return observedMinor === 0 ? 0 : 100 * 100;
  return Math.round(((observedMinor - baselineMinor) / baselineMinor) * 1000) / 10;
}

export function groupBy(records: readonly BillingRecord[], key: keyof BillingRecord): Record<string, number> {
  const out: Record<string, number> = {};
  for (const record of records) addTo(out, String(record[key] ?? "UNSPECIFIED"), record.amount_minor);
  return out;
}

/** แปลงหน่วยย่อยเป็นข้อความอ่านง่าย — ใช้แสดงผลเท่านั้น ไม่ใช้คำนวณต่อ */
export function formatMinor(minor: number, currency = "usd"): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${currency === "usd" ? "$" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** baseline จาก sample ที่จ่ายสำเร็จจริง — ค่ากลางแบบ median กัน outlier */
export function buildBaseline(input: Omit<CostBaseline, "normal_period_minor" | "normal_daily_minor" | "sample_count">): CostBaseline {
  const totals = input.samples.map((s) => s.total_minor).sort((a, b) => a - b);
  const median = totals.length === 0 ? 0
    : totals.length % 2 === 1 ? totals[(totals.length - 1) / 2]
      : Math.round((totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2);
  const days = input.samples.length === 0 ? 30
    : Math.round(input.samples.reduce((sum, s) => sum + periodDays(s.period_start, s.period_end), 0) / input.samples.length);
  return {
    ...input,
    normal_period_minor: median,
    normal_daily_minor: Math.round(median / Math.max(1, days)),
    sample_count: input.samples.length,
  };
}
