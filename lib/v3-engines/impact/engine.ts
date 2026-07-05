/**
 * Business Impact Engine
 *
 * สรุปผลกระทบธุรกิจตามมิติ (การเงิน/ปฏิบัติการ) จากข้อมูลจริงใน DB เท่านั้น
 * ห้าม hardcode ตัวเลขธุรกิจ — ถ้ามิติไหนไม่มีข้อมูลจริงรองรับ (เช่น deadline ภาษี)
 * จะไม่สร้างการ์ดให้มิตินั้น แทนที่จะเดา
 */

import { getDebtTrackings, getJobs } from "@/lib/supabase/queries";
import { calcDebtTrackingSummary } from "@/lib/v3-engines/debt/tracking";
import { round } from "@/lib/shared/types";

export interface ImpactCard {
  id: string;
  dimension: string;
  title: string;
  detail: string;
  severity: "low" | "medium" | "high";
}

export async function getFinancialImpact(): Promise<ImpactCard> {
  const trackings = await getDebtTrackings();

  if (trackings.length === 0) {
    return {
      id: "financial",
      dimension: "การเงิน",
      title: "ไม่มีลูกหนี้ในระบบติดตามหนี้",
      detail: "ยังไม่มี record ใน debt_trackings",
      severity: "low",
    };
  }

  let totalOutstanding = 0;
  let overdueCount = 0;
  for (const t of trackings) {
    const s = calcDebtTrackingSummary({
      principalAmount: Number(t.principal_amount ?? 0),
      feeRate: Number(t.fee_rate ?? 0),
      interestStartAt: t.interest_start_at,
    });
    totalOutstanding += s.totalAmount;
    if (s.daysOverdue > 0) overdueCount++;
  }

  return {
    id: "financial",
    dimension: "การเงิน",
    title: `ยอดหนี้ค้างรวม ${round(totalOutstanding).toLocaleString("th-TH")} บาท`,
    detail: `จากลูกหนี้ ${trackings.length} ราย — ${overdueCount} รายเลยกำหนดชำระแล้ว`,
    severity: overdueCount > 0 ? "high" : "medium",
  };
}

export async function getOperationalImpact(): Promise<ImpactCard> {
  const jobs = await getJobs();

  if (jobs.length === 0) {
    return {
      id: "operational",
      dimension: "ปฏิบัติการ",
      title: "ไม่มีงานในระบบ",
      detail: "ยังไม่มี record ใน jobs",
      severity: "low",
    };
  }

  const byStatus: Record<string, number> = {};
  for (const j of jobs) byStatus[j.job_status] = (byStatus[j.job_status] ?? 0) + 1;
  const suspended = byStatus["SUSPENDED"] ?? 0;
  const inProgress = byStatus["IN_PROGRESS"] ?? 0;
  const pendingReview = byStatus["PENDING_REVIEW"] ?? 0;

  const parts = Object.entries(byStatus).map(([status, n]) => `${status}: ${n}`);

  return {
    id: "operational",
    dimension: "ปฏิบัติการ",
    title: suspended > 0 ? `มีงานถูกระงับ ${suspended} งาน` : `กำลังดำเนินการ ${inProgress} งาน`,
    detail: `งานทั้งหมด ${jobs.length} รายการ (${parts.join(", ")})`,
    severity: suspended > 0 ? "high" : pendingReview > 0 ? "medium" : "low",
  };
}

// รวมทุกมิติที่มีข้อมูลจริงรองรับ ณ ตอนนี้
export async function getBusinessImpact(): Promise<ImpactCard[]> {
  const [financial, operational] = await Promise.all([
    getFinancialImpact(),
    getOperationalImpact(),
  ]);
  return [financial, operational];
}
