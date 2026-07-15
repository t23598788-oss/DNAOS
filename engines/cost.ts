import { supabase } from "@/services/supabase/queries";
import { loadConfigs, getNum, audit, assertAllKnown, type AuditTrail, type VerifiedValue } from "@/core/config-loader";
import { calcFuel } from "./fuel";

export interface CostInput {
  distance_km: number;
  quantity: number;
  trips: number;
  material_type_id?: string;
  pit_profile_id?: string;
  vehicle_type_id?: string;
}

export interface CostResult {
  material_cost: number;
  material_unit_price: number;
  fuel_cost: number;
  driver_wage: number;
  total_cost: number;
  audit: AuditTrail;
}

export async function calcCost(input: CostInput): Promise<CostResult> {
  const configs = await loadConfigs(supabase());
  const driverWage = getNum(configs, "driver-wage-per-trip");

  let materialPrice = 0;
  const materialVerified: VerifiedValue = {
    key: "material_unit_price",
    value: 0,
    source: "assumed",
  };

  if (input.pit_profile_id && input.material_type_id) {
    const { data: pm } = await supabase()
      .from("pit_materials")
      .select("price")
      .eq("pit_profile_id", input.pit_profile_id)
      .eq("material_type_id", input.material_type_id)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (pm?.price) {
      materialPrice = pm.price;
      materialVerified.value = pm.price;
      materialVerified.source = "db";
      materialVerified.reference = `pit_materials:pit_profile_id=${input.pit_profile_id},material_type_id=${input.material_type_id}`;
    }
  }

  assertAllKnown([materialVerified]);

  const materialCost = input.quantity * materialPrice;

  const fuel = await calcFuel({
    distance_km: input.distance_km,
    trips: input.trips,
    vehicle_type_id: input.vehicle_type_id,
  });

  const totalDriverWage = driverWage * input.trips;
  const totalCost = materialCost + fuel.total_fuel_cost + totalDriverWage;

  const rules = {
    driver_wage_per_trip: driverWage,
    material_price_per_unit: materialPrice,
    formula: "(qty * material_price) + fuel_cost + (driver_wage * trips)",
  };

  return {
    material_cost: parseFloat(materialCost.toFixed(2)),
    material_unit_price: materialPrice,
    fuel_cost: fuel.total_fuel_cost,
    driver_wage: totalDriverWage,
    total_cost: parseFloat(totalCost.toFixed(2)),
    audit: audit("cost", input, rules, { material_cost: materialCost, fuel_cost: fuel.total_fuel_cost, driver_wage: totalDriverWage, total_cost: totalCost }),
  };
}
