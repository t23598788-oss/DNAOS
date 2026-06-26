import { supabase } from "@/lib/supabase/queries";
import { loadConfigs, getNum, audit, type AuditTrail } from "./config-loader";

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
  const configs = await loadConfigs();
  const fuelPrice = getNum(configs, "fuel-price", 43);
  let consumptionRate = getNum(configs, "default-fuel-consumption", 6.5);

  if (input.vehicle_type_id) {
    const { data: vt } = await supabase()
      .from("vehicle_types")
      .select("fuel_consumption_rate")
      .eq("id", input.vehicle_type_id)
      .single();
    if (vt?.fuel_consumption_rate) {
      consumptionRate = vt.fuel_consumption_rate;
    }
  }

  const roundTripKm = input.distance_km * 2;
  const litersPerTrip = roundTripKm / consumptionRate;
  const costPerTrip = litersPerTrip * fuelPrice;
  const totalCost = costPerTrip * input.trips;

  const rules = { fuel_price_per_liter: fuelPrice, consumption_rate_km_per_liter: consumptionRate, formula: "(distance*2/rate)*price" };

  return {
    fuel_liters_per_trip: parseFloat(litersPerTrip.toFixed(2)),
    fuel_cost_per_trip: parseFloat(costPerTrip.toFixed(2)),
    total_fuel_cost: parseFloat(totalCost.toFixed(2)),
    audit: audit("fuel", input, rules, { fuel_liters_per_trip: litersPerTrip, fuel_cost_per_trip: costPerTrip, total_fuel_cost: totalCost }),
  };
}
