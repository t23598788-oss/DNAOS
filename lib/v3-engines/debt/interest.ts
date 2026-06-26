/**
 * Debt Interest — ต้นทบดอกรายวัน
 *
 * ทุกค่ามาจาก debt_policy ไม่ hardcode
 * สูตร: (P+F) × (1 + r/365)^d
 */

export interface InterestInput {
  principal: number;
  fee: number;
  dailyRate: number;
  daysOverdue: number;
}

export interface InterestResult {
  base: number;
  currentValue: number;
  interestAccrued: number;
  formula: string;
}

export function calcCompoundInterest(input: InterestInput): InterestResult {
  const base = input.principal + input.fee;
  const currentValue = base * Math.pow(1 + input.dailyRate, input.daysOverdue);
  const interestAccrued = currentValue - base;

  return {
    base,
    currentValue: round(currentValue),
    interestAccrued: round(interestAccrued),
    formula: `(${fmt(input.principal)}+${fmt(input.fee)}) × (1+${input.dailyRate.toFixed(6)})^${input.daysOverdue} = ${fmt(round(currentValue))}`,
  };
}

export function calcDaysOverdue(dueDate: Date, asOf: Date = new Date()): number {
  return Math.max(0, Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000));
}

function round(n: number): number { return Math.round(n * 100) / 100; }
function fmt(n: number): string { return n.toLocaleString("th-TH", { minimumFractionDigits: 2 }); }
