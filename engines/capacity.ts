import { supabase } from "@/services/supabase/queries";
import { loadConfigs, getNum, audit, type AuditTrail } from "@/core/config-loader";

export interface CapacityInput {
  quantity: number;
  vehicle_type_id?: string;
}

export interface CapacityResult {
  vehicle_capacity: number;
  trips_required: number;
  audit: AuditTrail;
}

export async function calcCapacity(input: CapacityInput): Promise<CapacityResult> {
  const configs = await loadConfigs();
  let capacity = getNum(configs, "vehicle-default-capacity");

  if (input.vehicle_type_id) {
    const { data: vt } = await supabase()
      .from("vehicle_types")
      .select("load_capacity")
      .eq("id", input.vehicle_type_id)
      .single();
    if (vt?.load_capacity) capacity = vt.load_capacity;
  }

  const trips = Math.ceil(input.quantity / capacity);

  const rules = { vehicle_capacity_cubic: capacity, formula: "ceil(quantity / capacity)" };

  return {
    vehicle_capacity: capacity,
    trips_required: trips,
    audit: audit("capacity", input, rules, { trips_required: trips }),
  };
}
