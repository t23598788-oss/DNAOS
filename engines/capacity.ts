import { supabase, supabaseAdmin } from "@/services/supabase/queries";
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

// Owner correction (2026-07-24): "ความจุรถ...มันมีอยู่ในตารางของรถบรรทุก
// แต่ละชนิดอยู่แล้ว...ทำไมต้องมาถามอีก" — vehicle_types.load_capacity IS the
// real per-truck spec sheet (รถ 6 ล้อ=5 คิว, รถ 10 ล้อ=9 คิว, รถพ่วง=22 คิว,
// confirmed live). A real job always resolves a real vehicle_type_id, so
// this is the source of truth every time one is given — the app_configs
// fallback is only for the rare case no vehicle is specified at all, and is
// looked up lazily (never required upfront just because it might be used).
export async function calcCapacity(input: CapacityInput): Promise<CapacityResult> {
  let capacity: number | undefined;
  let source = "";

  if (input.vehicle_type_id) {
    // vehicle_types has RLS policy service_role_only (qual=false) — the
    // anon client (supabase()) silently gets zero rows for ANY query here,
    // always. Found live 2026-07-24 while chasing why this real vehicle
    // data was never actually being used. supabaseAdmin() is required.
    const { data: vt } = await supabaseAdmin()
      .from("vehicle_types")
      .select("load_capacity")
      .eq("id", input.vehicle_type_id)
      .single();
    if (vt?.load_capacity) {
      capacity = vt.load_capacity;
      source = `vehicle_types.id=${input.vehicle_type_id}`;
    }
  }

  if (capacity === undefined) {
    const configs = await loadConfigs(supabase());
    capacity = getNum(configs, "vehicle-default-capacity");
    source = "app_configs.vehicle-default-capacity (fallback — no real vehicle_type_id given)";
  }

  const trips = Math.ceil(input.quantity / capacity);

  const rules = { vehicle_capacity_cubic: capacity, source, formula: "ceil(quantity / capacity)" };

  return {
    vehicle_capacity: capacity,
    trips_required: trips,
    audit: audit("capacity", input, rules, { trips_required: trips }),
  };
}
