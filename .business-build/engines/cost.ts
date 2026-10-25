import { supabaseAdmin } from "@/services/supabase/queries";
import { audit, assertAllKnown, type AuditTrail, type VerifiedValue } from "@/core/config-loader";
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
  total_cost: number;
  audit: AuditTrail;
}

// Owner correction (2026-07-25): "driver-wage-per-trip" ไม่มีอยู่จริงในธุรกิจ
// นี้ — เจ้าของรถเป็นผู้รับเหมาอิสระ เฮียเป็นคนเสนอราคาให้เขา (ไม่ใช่เขาเสนอมา)
// คำนวณจากระยะทางจริง (GPS) × ราคาน้ำมันจริง (ปั๊ม) เป็นฐาน — ไม่มีค่าแรงคนขับ
// เป็นตัวเลขคงที่แยกต่างหากให้ hardcode ต้นทุนขนส่งจริง = ต้นทุนน้ำมันจริงเท่านั้น
// ตัวเลขที่ได้คือฐานราคาที่เฮียใช้เสนอเจ้าของรถ ไม่ใช่ราคาสุดท้ายที่จ่ายจริง —
// ราคาสุดท้ายที่ตกลงกันจริงต้องบันทึกเป็นข้อมูลจริงต่องานใน job_vehicle_pricings
// (ตารางที่มีอยู่แล้ว ออกแบบไว้เก็บข้อมูลจริงต่องานอยู่แล้ว แต่ไม่เคยมีใครเขียนลง)
// ไม่ใช่ค่าคงที่ใน app_configs
export async function calcCost(input: CostInput): Promise<CostResult> {
  let materialPrice = 0;
  const materialVerified: VerifiedValue = {
    key: "material_unit_price",
    value: 0,
    source: "assumed",
  };

  if (input.pit_profile_id && input.material_type_id) {
    // pit_materials RLS is service_role_only — anon client silently gets
    // zero rows here always, which used to make every real cost calc fall
    // through to assertAllKnown's "assumed" failure. Found live 2026-07-24.
    const { data: pm } = await supabaseAdmin()
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

  const totalCost = materialCost + fuel.total_fuel_cost;

  const rules = {
    material_price_per_unit: materialPrice,
    formula: "(qty * material_price) + fuel_cost — real GPS distance x real pump fuel price, no fixed driver-wage constant (owner correction, 2026-07-25)",
  };

  return {
    material_cost: parseFloat(materialCost.toFixed(2)),
    material_unit_price: materialPrice,
    fuel_cost: fuel.total_fuel_cost,
    total_cost: parseFloat(totalCost.toFixed(2)),
    audit: audit("cost", input, rules, { material_cost: materialCost, fuel_cost: fuel.total_fuel_cost, total_cost: totalCost }),
  };
}
