import { loadConfigs, getNum, audit, type AuditTrail } from "./config-loader";

export interface TaxInput {
  amount: number;
  vat_enabled?: boolean;
  vat_mode?: "inclusive" | "exclusive";
  withholding_tax_percent?: number;
}

export interface TaxResult {
  base_amount: number;
  vat_amount: number;
  gross_amount: number;
  withholding_amount: number;
  net_amount: number;
  audit: AuditTrail;
}

export async function calcTax(input: TaxInput): Promise<TaxResult> {
  const configs = await loadConfigs();
  const vatRate = getNum(configs, "vat-rate");
  const vatEnabled = input.vat_enabled ?? true;
  const vatMode = input.vat_mode ?? "inclusive";
  const whtPercent = input.withholding_tax_percent ?? 0;

  let baseAmount: number;
  let vatAmount: number;
  let grossAmount: number;

  if (!vatEnabled) {
    baseAmount = input.amount;
    vatAmount = 0;
    grossAmount = input.amount;
  } else if (vatMode === "inclusive") {
    grossAmount = input.amount;
    baseAmount = input.amount / (1 + vatRate / 100);
    vatAmount = grossAmount - baseAmount;
  } else {
    baseAmount = input.amount;
    vatAmount = baseAmount * (vatRate / 100);
    grossAmount = baseAmount + vatAmount;
  }

  const withholdingAmount = baseAmount * (whtPercent / 100);
  const netAmount = grossAmount - withholdingAmount;

  const rules = { vat_rate: vatRate, vat_enabled: vatEnabled, vat_mode: vatMode, withholding_percent: whtPercent };

  return {
    base_amount: parseFloat(baseAmount.toFixed(2)),
    vat_amount: parseFloat(vatAmount.toFixed(2)),
    gross_amount: parseFloat(grossAmount.toFixed(2)),
    withholding_amount: parseFloat(withholdingAmount.toFixed(2)),
    net_amount: parseFloat(netAmount.toFixed(2)),
    audit: audit("tax", input, rules, { base_amount: baseAmount, vat_amount: vatAmount, net_amount: netAmount }),
  };
}
