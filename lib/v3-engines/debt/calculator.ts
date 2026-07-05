/**
 * Debt Calculator — รวมยอดทั้งหมด ณ วันที่กำหนด
 *
 * เงินต้น + ค่าธรรมเนียม + ดอกเบี้ยสะสม + ค่าทวงถาม - ชำระแล้ว = ยอดคงเหลือ
 * ทุกค่ามาจาก policy (DB) ไม่ hardcode
 */

import { round } from "@/lib/shared/types";
import { calcCompoundInterest, calcDaysOverdue } from "./interest";
import { calcCollectionFee } from "./collection";
import { canAccrueInterest, canChargeCollectionFee, type DebtStatus } from "./status";

export interface DebtSummaryInput {
  principal: number;
  feeRate: number;
  interestRate: number;
  collectionFeeRate: number;
  collectionFeeLimit: number;
  dueDate: string;
  status: DebtStatus;
  paidAmount: number;
  asOfDate?: string;
}

export interface DebtSummary {
  principal: number;
  fee: number;
  base: number;
  daysOverdue: number;
  interestAccrued: number;
  collectionFee: number;
  grossTotal: number;
  paidAmount: number;
  netRemaining: number;
}

export function calcDebtSummary(input: DebtSummaryInput): DebtSummary {
  const fee = round(input.principal * (input.feeRate / 100));
  const base = input.principal + fee;
  const due = new Date(input.dueDate);
  const asOf = input.asOfDate ? new Date(input.asOfDate) : new Date();
  const days = calcDaysOverdue(due, asOf);

  let interestAccrued = 0;
  if (canAccrueInterest(input.status) && days > 0) {
    const remaining = Math.max(0, input.principal - input.paidAmount);
    const r = calcCompoundInterest({
      principal: remaining,
      fee,
      dailyRate: input.interestRate / 100 / 365,
      daysOverdue: days,
    });
    interestAccrued = r.interestAccrued;
  }

  let collectionFee = 0;
  if (canChargeCollectionFee(input.status)) {
    const outstanding = base + interestAccrued - input.paidAmount;
    const c = calcCollectionFee({
      outstanding,
      feeRate: input.collectionFeeRate,
      legalLimit: input.collectionFeeLimit,
    });
    collectionFee = c.appliedFee;
  }

  const grossTotal = base + interestAccrued + collectionFee;
  const netRemaining = Math.max(0, grossTotal - input.paidAmount);

  return {
    principal: input.principal,
    fee: round(fee),
    base: round(base),
    daysOverdue: days,
    interestAccrued: round(interestAccrued),
    collectionFee: round(collectionFee),
    grossTotal: round(grossTotal),
    paidAmount: input.paidAmount,
    netRemaining: round(netRemaining),
  };
}

