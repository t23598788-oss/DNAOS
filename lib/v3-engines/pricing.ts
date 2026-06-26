import { loadConfigs, getNum, audit, type AuditTrail } from "./config-loader";

export interface PricingInput {
  total_cost: number;
  material_cost: number;
  fuel_cost: number;
  driver_wage: number;
  trips: number;
  is_urgent?: boolean;
}

export interface PricingResult {
  selling_price: number;
  profit: number;
  system_fee: number;
  urgent_fee: number;
  price_per_trip: number;
  audit: AuditTrail;
}

export async function calcPricing(input: PricingInput): Promise<PricingResult> {
  const configs = await loadConfigs();
  const markupPercent = getNum(configs, "pricing-markup-percent", 25);
  const systemFeePercent = getNum(configs, "system-fee-percent", 3);
  const urgentFeePercent = getNum(configs, "urgent-fee-percent", 15);

  const markup = input.total_cost * (markupPercent / 100);
  const systemFee = input.total_cost * (systemFeePercent / 100);
  const urgentFee = input.is_urgent ? input.total_cost * (urgentFeePercent / 100) : 0;
  const profit = markup - systemFee;
  const sellingPrice = input.total_cost + markup + urgentFee;
  const pricePerTrip = input.trips > 0 ? sellingPrice / input.trips : sellingPrice;

  const rules = {
    markup_percent: markupPercent,
    system_fee_percent: systemFeePercent,
    urgent_fee_percent: urgentFeePercent,
    formula: "cost + (cost * markup%) + urgent_fee",
  };

  return {
    selling_price: parseFloat(sellingPrice.toFixed(2)),
    profit: parseFloat(profit.toFixed(2)),
    system_fee: parseFloat(systemFee.toFixed(2)),
    urgent_fee: parseFloat(urgentFee.toFixed(2)),
    price_per_trip: parseFloat(pricePerTrip.toFixed(2)),
    audit: audit("pricing", input, rules, { selling_price: sellingPrice, profit, system_fee: systemFee }),
  };
}
