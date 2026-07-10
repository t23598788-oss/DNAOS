import { audit, type AuditTrail } from "@/core/config-loader";

export interface VehicleSelectorInput {
  distance_km: number;
}

export interface VehicleSpec {
  label: string;
  max_volume_m3: number;
  max_weight_ton: number;
  consumption_km_per_l: number;
}

export interface VehicleSelectorResult {
  recommended_type: "รถหกล้อ" | "รถสิบล้อ" | "รถพ่วง";
  spec: VehicleSpec;
  reason: string;
  audit: AuditTrail;
}

// Business law: ระยะใกล้ → รถเล็ก, ระยะไกล → รถใหญ่
// ≤30 กม.: รถหกล้อ | 31–100 กม.: รถสิบล้อ | >100 กม.: รถพ่วง
const SPECS: Record<string, VehicleSpec> = {
  รถหกล้อ: { label: "รถหกล้อ", max_volume_m3: 5, max_weight_ton: 6, consumption_km_per_l: 6 },
  รถสิบล้อ: { label: "รถสิบล้อ", max_volume_m3: 10, max_weight_ton: 15, consumption_km_per_l: 4.5 },
  รถพ่วง: { label: "รถพ่วง", max_volume_m3: 22, max_weight_ton: 30, consumption_km_per_l: 3.5 },
};

export function selectVehicle(input: VehicleSelectorInput): VehicleSelectorResult {
  let type: "รถหกล้อ" | "รถสิบล้อ" | "รถพ่วง";
  let reason: string;

  if (input.distance_km <= 30) {
    type = "รถหกล้อ";
    reason = `ระยะ ${input.distance_km} กม. (≤30) — รถเล็กคล่องตัวกว่า ได้ปริมาณต่อเวลามากกว่า`;
  } else if (input.distance_km <= 100) {
    type = "รถสิบล้อ";
    reason = `ระยะ ${input.distance_km} กม. (31–100) — สมดุลระหว่างความจุและค่าน้ำมัน`;
  } else {
    type = "รถพ่วง";
    reason = `ระยะ ${input.distance_km} กม. (>100) — รถใหญ่ลดต้นทุนต่อคิวในระยะไกล`;
  }

  const spec = SPECS[type];
  const rules = { distance_km: input.distance_km, thresholds: "≤30: หกล้อ, 31-100: สิบล้อ, >100: พ่วง" };

  return {
    recommended_type: type,
    spec,
    reason,
    audit: audit("vehicle-selector", input, rules, { recommended_type: type }),
  };
}

export function effectiveCapacity(spec: VehicleSpec, density_ton_per_m3: number): number {
  const byWeight = spec.max_weight_ton / density_ton_per_m3;
  return Math.floor(Math.min(spec.max_volume_m3, byWeight));
}
