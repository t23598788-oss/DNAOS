import { supabase, supabaseAdmin } from "@/services/supabase/queries";
import {
  loadConfigs, getNum, getConfigUpdatedAt, audit,
  assertNotStale, STALENESS_HOURS,
  type AuditTrail, type VerifiedValue,
} from "@/core/config-loader";

export interface FuelInput {
  distance_km: number;
  trips: number;
  vehicle_type_id?: string;
}

export interface FuelResult {
  fuel_liters_per_trip: number;
  fuel_cost_per_trip: number;
  total_fuel_cost: number;
  audit: AuditTrail;
}

export async function calcFuel(input: FuelInput): Promise<FuelResult> {
  const configs = await loadConfigs(supabase());
  const fuelPrice = getNum(configs, "fuel-price");

  // ── Temporal provenance check — ราคาน้ำมันต้องไม่เก่าเกิน 7 วัน ────────────
  const fuelPriceVerified: VerifiedValue = {
    key: "fuel-price",
    value: fuelPrice,
    source: "config",
    reference: "app_configs.fuel-price",
    refreshed_at: getConfigUpdatedAt("fuel-price"),
    staleness_hours: STALENESS_HOURS["fuel-price"],
  };
  assertNotStale([fuelPriceVerified]);

  // Owner correction (2026-07-24): vehicle_types.fuel_consumption_rate IS
  // the real per-truck spec sheet — a real vehicle_type_id is the source of
  // truth every time one is given. app_configs is only a lazy fallback for
  // the rare case no vehicle is specified, not required upfront.
  let consumptionRate: number | undefined;

  if (input.vehicle_type_id) {
    // vehicle_types RLS is service_role_only — anon client silently returns
    // zero rows here always. Same bug/fix as engines/capacity.ts.
    const { data: vt } = await supabaseAdmin()
      .from("vehicle_types")
      .select("fuel_consumption_rate")
      .eq("id", input.vehicle_type_id)
      .single();
    if (vt?.fuel_consumption_rate) {
      consumptionRate = vt.fuel_consumption_rate;
    }
  }

  if (consumptionRate === undefined) {
    consumptionRate = getNum(configs, "default-fuel-consumption");
  }

  const roundTripKm = input.distance_km * 2;
  const litersPerTrip = roundTripKm / consumptionRate;
  const costPerTrip = litersPerTrip * fuelPrice;
  const totalCost = costPerTrip * input.trips;

  const rules = {
    fuel_price_per_liter: fuelPrice,
    fuel_price_refreshed_at: fuelPriceVerified.refreshed_at ?? "unknown",
    consumption_rate_km_per_liter: consumptionRate,
    formula: "(distance*2/rate)*price",
  };

  return {
    fuel_liters_per_trip: parseFloat(litersPerTrip.toFixed(2)),
    fuel_cost_per_trip: parseFloat(costPerTrip.toFixed(2)),
    total_fuel_cost: parseFloat(totalCost.toFixed(2)),
    audit: audit("fuel", input, rules, { fuel_liters_per_trip: litersPerTrip, fuel_cost_per_trip: costPerTrip, total_fuel_cost: totalCost }),
  };
}
