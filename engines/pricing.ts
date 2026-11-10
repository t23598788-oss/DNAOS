import { loadConfigs, getNum, audit, type AuditTrail } from "@/core/config-loader";
import { supabase } from "@/services/supabase/queries";

export interface PricingInput {
  total_cost: number;
  material_cost: number;
  fuel_cost: number;
  trips: number;
  is_urgent?: boolean;
}

export interface PricingResult {
  wear_cost: number;
  selling_price_ex_vat: number;
  vat: number;
  selling_price: number;
  profit: number;
  system_fee: number;
  urgent_fee: number;
  price_per_trip: number;
  audit: AuditTrail;
}

export async function calcPricing(input: PricingInput): Promise<PricingResult> {
  const configs = await loadConfigs(supabase());
  const markupPercent = getNum(configs, "pricing-markup-percent");
  const systemFeePercent = getNum(configs, "system-fee-percent");
  const urgentFeePercent = getNum(configs, "urgent-fee-percent");
  // Owner rule (2026-11-02): no silent default. The old `?? 1.7` invented a
  // wear rate whenever the config row was absent — a price number with no
  // stored cause. getNum() already throws [CONFIG MISSING] for that exact case.
  const wearPercent = getNum(configs, "wear-percent");
  // Owner rule (2026-11-02): VAT is a price number too — read it, never
  // hardcode 0.07. Stored as a FRACTION in app_configs (0.07 = 7%).
  const vatRate = getNum(configs, "vat-rate");

  // wear applies to transport cost only (real GPS distance x real fuel
  // price — no separate driver-wage constant, owner correction 2026-07-25:
  // the truck owner is an independent contractor, wage isn't a cost DNA OS
  // pays separately), not to material cost
  const wearCost = input.fuel_cost * (wearPercent / 100);

  const totalWithWear = input.total_cost + wearCost;
  const markup = totalWithWear * (markupPercent / 100);
  const systemFee = totalWithWear * (systemFeePercent / 100);
  const urgentFee = input.is_urgent ? totalWithWear * (urgentFeePercent / 100) : 0;
  const profit = markup - systemFee;

  const sellingExVAT = totalWithWear + markup + urgentFee;
  const vat = sellingExVAT * vatRate;
  const sellingPrice = sellingExVAT + vat;
  const pricePerTrip = input.trips > 0 ? sellingPrice / input.trips : sellingPrice;

  const rules = {
    markup_percent: markupPercent,
    system_fee_percent: systemFeePercent,
    urgent_fee_percent: urgentFeePercent,
    wear_percent: wearPercent,
    vat_percent: vatRate * 100,
    formula: `(cost + wear) + markup% + urgent_fee + VAT ${vatRate * 100}%`,
  };

  return {
    wear_cost: parseFloat(wearCost.toFixed(2)),
    selling_price_ex_vat: parseFloat(sellingExVAT.toFixed(2)),
    vat: parseFloat(vat.toFixed(2)),
    selling_price: parseFloat(sellingPrice.toFixed(2)),
    profit: parseFloat(profit.toFixed(2)),
    system_fee: parseFloat(systemFee.toFixed(2)),
    urgent_fee: parseFloat(urgentFee.toFixed(2)),
    price_per_trip: parseFloat(pricePerTrip.toFixed(2)),
    audit: audit("pricing", input, rules, { wear_cost: wearCost, selling_price_ex_vat: sellingExVAT, vat, selling_price: sellingPrice }),
  };
}
