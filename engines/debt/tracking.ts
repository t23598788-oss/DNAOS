/**
 * Debt Tracking Calculator — ลูกหนี้แยก (debt_trackings)
 *
 * ดอกเบี้ยคงที่ 25%/ปี แบบไม่ทบต้น (simple interest)
 * ต่างจาก calcCompoundInterest (invoice_debts) ซึ่งเป็นดอกเบี้ยทบต้น
 * ทุกค่าคำนวณจาก record จริงใน debt_trackings ห้าม hardcode ตัวเลขธุรกิจอื่น
 */

import { round } from "@/core/shared/types";
import { calcDaysOverdue } from "./interest";

export const DEBT_TRACKING_INTEREST_RATE = 0.25;

// ค่าปรับ/ค่าติดตามทวงถาม — เริ่มนับวันละ 100 บาท หลังวันผิดนัดชำระ
export const DEBT_TRACKING_PENALTY_PER_DAY = 100;

// วันผ่อนผันก่อนถือเป็นผิดนัดชำระ นับจากวันเริ่มคิดดอกเบี้ย (interestStartAt + 30 วัน = วันผิดนัดชำระ)
export const DEBT_TRACKING_GRACE_DAYS = 30;

export interface DebtTrackingInput {
  principalAmount: number;
  feeRate: number;
  interestStartAt: string;
  asOfDate?: string;
}

export interface DebtTrackingSummary {
  principalAmount: number;
  feeRate: number;
  feeAmount: number;
  daysElapsed: number;
  interestRate: number;
  interestAmount: number;
  defaultDate: string;
  daysOverdue: number;
  penaltyAmount: number;
  totalAmount: number;
}

export function calcDebtTrackingSummary(input: DebtTrackingInput): DebtTrackingSummary {
  const start = new Date(input.interestStartAt);
  const asOf = input.asOfDate ? new Date(input.asOfDate) : new Date();
  const daysElapsed = calcDaysOverdue(start, asOf);

  const feeAmount = round(input.principalAmount * (input.feeRate / 100));
  const base = input.principalAmount + feeAmount;
  const interestAmount = round((base * DEBT_TRACKING_INTEREST_RATE * daysElapsed) / 365);

  const defaultDateObj = new Date(start);
  defaultDateObj.setDate(defaultDateObj.getDate() + DEBT_TRACKING_GRACE_DAYS);
  const daysOverdue = calcDaysOverdue(defaultDateObj, asOf);
  const penaltyAmount = round(daysOverdue * DEBT_TRACKING_PENALTY_PER_DAY);

  const totalAmount = round(base + interestAmount + penaltyAmount);

  return {
    principalAmount: input.principalAmount,
    feeRate: input.feeRate,
    feeAmount,
    daysElapsed,
    interestRate: DEBT_TRACKING_INTEREST_RATE,
    interestAmount,
    defaultDate: defaultDateObj.toISOString().split("T")[0],
    daysOverdue,
    penaltyAmount,
    totalAmount,
  };
}
