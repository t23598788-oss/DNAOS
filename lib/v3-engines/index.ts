export { loadConfigs } from "./config-loader";
export { calcDistance, findNearestPit } from "./distance";
export { calcTime } from "./time";
export { calcFuel } from "./fuel";
export { calcCost } from "./cost";
export { calcPricing } from "./pricing";
export { calcTax } from "./tax";
export { calcDebtFull, calcCompoundInterest, calcDaysOverdue, checkOverdue, nextStatus } from "./debt/engine";
export type { DebtStatus } from "./debt/engine";
export { calcCapacity } from "./capacity";
export { loadBusinessRules, calculatePrice, calculateDebt } from "./business";

import type { AuditTrail } from "./config-loader";
import { findNearestPit } from "./distance";
import { calcCapacity } from "./capacity";
import { calcTime } from "./time";
import { calcCost } from "./cost";
import { calcPricing } from "./pricing";
import { calcTax } from "./tax";

export interface QuoteInput {
  site_lat: number;
  site_lng: number;
  material_type_id: string;
  quantity: number;
  vehicle_type_id?: string;
  is_urgent?: boolean;
  vat_enabled?: boolean;
  withholding_tax_percent?: number;
}

export interface QuoteResult {
  distance_km: number;
  pit_name: string;
  pit_id: string;
  trips: number;
  vehicle_capacity: number;
  hours_total: number;
  material_cost: number;
  fuel_cost: number;
  driver_wage: number;
  total_cost: number;
  selling_price: number;
  profit: number;
  vat_amount: number;
  net_amount: number;
  audits: AuditTrail[];
}

export async function calcFullQuote(input: QuoteInput): Promise<QuoteResult> {
  const audits: AuditTrail[] = [];

  const dist = await findNearestPit(input.site_lat, input.site_lng, input.material_type_id);
  audits.push(dist.audit);

  const cap = await calcCapacity({ quantity: input.quantity, vehicle_type_id: input.vehicle_type_id });
  audits.push(cap.audit);

  const time = await calcTime({ distance_km: dist.distance_km, trips: cap.trips_required });
  audits.push(time.audit);

  const cost = await calcCost({
    distance_km: dist.distance_km,
    quantity: input.quantity,
    trips: cap.trips_required,
    material_type_id: input.material_type_id,
    pit_profile_id: dist.nearest_pit?.id,
    vehicle_type_id: input.vehicle_type_id,
  });
  audits.push(cost.audit);

  const pricing = await calcPricing({
    total_cost: cost.total_cost,
    material_cost: cost.material_cost,
    fuel_cost: cost.fuel_cost,
    driver_wage: cost.driver_wage,
    trips: cap.trips_required,
    is_urgent: input.is_urgent,
  });
  audits.push(pricing.audit);

  const tax = await calcTax({
    amount: pricing.selling_price,
    vat_enabled: input.vat_enabled,
    withholding_tax_percent: input.withholding_tax_percent,
  });
  audits.push(tax.audit);

  return {
    distance_km: dist.distance_km,
    pit_name: dist.nearest_pit?.name ?? "-",
    pit_id: dist.nearest_pit?.id ?? "-",
    trips: cap.trips_required,
    vehicle_capacity: cap.vehicle_capacity,
    hours_total: time.total_hours,
    material_cost: cost.material_cost,
    fuel_cost: cost.fuel_cost,
    driver_wage: cost.driver_wage,
    total_cost: cost.total_cost,
    selling_price: pricing.selling_price,
    profit: pricing.profit,
    vat_amount: tax.vat_amount,
    net_amount: tax.net_amount,
    audits,
  };
}
