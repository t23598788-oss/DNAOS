/**
 * Debt Engine — รวมทุกอย่างของระบบหนี้
 *
 * ดึง policy จาก config-loader (DB)
 * คำนวณ: สถานะ + ดอกเบี้ย + ค่าทวงถาม + ยอดรวม
 * AI ห้ามเรียกตรง — ต้องผ่าน Engine เท่านั้น
 */

import { loadConfigs, getNum, audit, type AuditTrail } from "../config-loader";
import { calcCompoundInterest, calcDaysOverdue } from "./interest";
import { checkOverdue } from "./overdue";
import { calcCollectionFee } from "./collection";
import { canAccrueInterest, canChargeCollectionFee, type DebtStatus } from "./status";

export interface DebtCalcInput {
  principal: number;
  feeAmount: number;
  dueDate: string;
  paidAmount?: number;
  status: DebtStatus;
  asOfDate?: string;
}

export interface DebtCalcResult {
  principal: number;
  fee: number;
  status: DebtStatus;
  daysOverdue: number;
  isOverdue: boolean;
  interestAccrued: number;
  collectionFee: number;
  collectionCapped: boolean;
  totalOutstanding: number;
  paidAmount: number;
  remaining: number;
  formula: string;
  audit: AuditTrail;
}

export async function calcDebtFull(input: DebtCalcInput): Promise<DebtCalcResult> {
  const configs = await loadConfigs();
  const interestRate = getNum(configs, "debt-interest-rate", 25) / 100;
  const gracePeriodHours = getNum(configs, "debt-grace-period-hours", 24);
  const collectionFeeRate = getNum(configs, "debt-collection-fee-rate", 5);
  const collectionFeeLimit = getNum(configs, "debt-collection-fee-limit", 100000);

  const due = new Date(input.dueDate);
  const asOf = input.asOfDate ? new Date(input.asOfDate) : new Date();
  const paid = input.paidAmount ?? 0;

  const overdueCheck = checkOverdue(due, gracePeriodHours, asOf);
  const days = calcDaysOverdue(due, asOf);

  let interestAccrued = 0;
  let formula = "";
  if (canAccrueInterest(input.status) && days > 0) {
    const remaining = Math.max(0, input.principal - paid);
    const r = calcCompoundInterest({
      principal: remaining,
      fee: input.feeAmount,
      dailyRate: interestRate / 365,
      daysOverdue: days,
    });
    interestAccrued = r.interestAccrued;
    formula = r.formula;
  }

  let collectionFee = 0;
  let collectionCapped = false;
  if (canChargeCollectionFee(input.status)) {
    const c = calcCollectionFee({
      outstanding: input.principal + input.feeAmount + interestAccrued - paid,
      feeRate: collectionFeeRate,
      legalLimit: collectionFeeLimit,
    });
    collectionFee = c.appliedFee;
    collectionCapped = c.cappedByLaw;
  }

  const totalOutstanding = input.principal + input.feeAmount + interestAccrued + collectionFee;
  const remaining = Math.max(0, totalOutstanding - paid);

  const rules = {
    interest_rate: interestRate,
    grace_period_hours: gracePeriodHours,
    collection_fee_rate: collectionFeeRate,
    collection_fee_limit: collectionFeeLimit,
  };

  return {
    principal: input.principal,
    fee: input.feeAmount,
    status: input.status,
    daysOverdue: days,
    isOverdue: overdueCheck.isOverdue,
    interestAccrued: round(interestAccrued),
    collectionFee: round(collectionFee),
    collectionCapped,
    totalOutstanding: round(totalOutstanding),
    paidAmount: paid,
    remaining: round(remaining),
    formula,
    audit: audit("debt-engine", input, rules, { days, interestAccrued, collectionFee, totalOutstanding, remaining }),
  };
}

export { calcCompoundInterest, calcDaysOverdue } from "./interest";
export { checkOverdue } from "./overdue";
export { calcCollectionFee } from "./collection";
export { nextStatus, canAccrueInterest, canChargeCollectionFee, isTerminal } from "./status";
export type { DebtStatus } from "./status";
export { applyTransition, buildTransitionChain } from "./transition";
export type { TransitionEvent, TransitionResult } from "./transition";
export { checkDebtSchedule, checkBatch } from "./scheduler";
export { calcDebtSummary } from "./calculator";
export type { DebtSummary } from "./calculator";

function round(n: number): number { return Math.round(n * 100) / 100; }
