import { loadConfigs, getNum, audit, type AuditTrail } from "./config-loader";

export interface DebtInput {
  principal_amount: number;
  fee_rate: number;
  interest_start_at: string;
  paid_amount?: number;
  as_of_date?: string;
}

export interface DebtResult {
  principal: number;
  days_outstanding: number;
  interest_amount: number;
  penalty_amount: number;
  total_outstanding: number;
  paid_amount: number;
  remaining: number;
  audit: AuditTrail;
}

export async function calcDebt(input: DebtInput): Promise<DebtResult> {
  const configs = await loadConfigs();
  const penaltyDays = getNum(configs, "debt-penalty-after-days", 90);
  const penaltyRate = getNum(configs, "debt-penalty-rate", 2);

  const startDate = new Date(input.interest_start_at);
  const asOf = input.as_of_date ? new Date(input.as_of_date) : new Date();
  const diffMs = asOf.getTime() - startDate.getTime();
  const days = Math.max(0, Math.floor(diffMs / 86_400_000));

  const annualRate = input.fee_rate / 100;
  const interest = input.principal_amount * annualRate * (days / 365);

  const penalty = days > penaltyDays
    ? input.principal_amount * (penaltyRate / 100) * ((days - penaltyDays) / 365)
    : 0;

  const paid = input.paid_amount ?? 0;
  const totalOutstanding = input.principal_amount + interest + penalty;
  const remaining = Math.max(0, totalOutstanding - paid);

  const rules = {
    fee_rate_annual: input.fee_rate,
    penalty_after_days: penaltyDays,
    penalty_rate_annual: penaltyRate,
    formula: "principal + (principal * rate * days/365) + penalty - paid",
  };

  return {
    principal: input.principal_amount,
    days_outstanding: days,
    interest_amount: parseFloat(interest.toFixed(2)),
    penalty_amount: parseFloat(penalty.toFixed(2)),
    total_outstanding: parseFloat(totalOutstanding.toFixed(2)),
    paid_amount: paid,
    remaining: parseFloat(remaining.toFixed(2)),
    audit: audit("debt", input, rules, { days, interest, penalty, total_outstanding: totalOutstanding, remaining }),
  };
}
