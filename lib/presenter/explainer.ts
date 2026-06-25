/**
 * V5 Explainable Calculator
 *
 * ทุกตัวเลขต้องตอบ 3 คำถาม:
 * 1. มาจากไหน (source)
 * 2. คำนวณอย่างไร (formula)
 * 3. อัปเดตเมื่อไร (timestamp)
 */

import { supabase } from "@/lib/supabase/queries";
import { loadConfigs, getNum } from "@/lib/engines/config-loader";

export interface TracedValue {
  label: string;
  value: number | string;
  unit: string;
  source: string;
  formula: string;
  timestamp: string;
}

export interface ExplainedQuote {
  items: TracedValue[];
  summary: {
    total_cost: number;
    selling_price: number;
    profit: number;
  };
}

export async function explainQuote(params: {
  pit_id: string;
  site_lat: number;
  site_lng: number;
  quantity: number;
  material_type_id?: string;
  vehicle_type_id?: string;
}): Promise<ExplainedQuote> {
  const configs = await loadConfigs();
  const now = new Date().toISOString();
  const items: TracedValue[] = [];

  // 1. ดึงข้อมูล pit
  const { data: pit } = await supabase()
    .from("pit_profiles")
    .select("id, pit_name, latitude, longitude, updated_at")
    .eq("id", params.pit_id)
    .single();

  // 2. ระยะทาง
  const R = 6371;
  const dLat = ((pit?.latitude ?? 0) - params.site_lat) * Math.PI / 180;
  const dLng = ((pit?.longitude ?? 0) - params.site_lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(params.site_lat * Math.PI / 180) * Math.cos((pit?.latitude ?? 0) * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const rawDist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const minDist = getNum(configs, "minimum-distance", 15);
  const distance = Math.max(rawDist, minDist);

  items.push({
    label: "ระยะทาง",
    value: parseFloat(distance.toFixed(2)),
    unit: "กม.",
    source: `pit_profiles.id=${params.pit_id?.substring(0, 8)} (${pit?.pit_name ?? "?"}) → mission GPS (${params.site_lat}, ${params.site_lng})`,
    formula: `haversine(${params.site_lat}, ${params.site_lng}, ${pit?.latitude}, ${pit?.longitude}) = ${rawDist.toFixed(2)} กม. → max(${rawDist.toFixed(2)}, minimum-distance=${minDist}) = ${distance.toFixed(2)}`,
    timestamp: pit?.updated_at ?? now,
  });

  // 3. รถ + ความจุ
  let capacity = getNum(configs, "vehicle-default-capacity", 10);
  let vehicleName = "รถ 10 ล้อ (default)";
  let fuelRate = getNum(configs, "default-fuel-consumption", 6.5);
  let vehicleTs = now;

  if (params.vehicle_type_id) {
    const { data: vt } = await supabase().from("vehicle_types").select("name, load_capacity, fuel_consumption_rate, updated_at").eq("id", params.vehicle_type_id).single();
    if (vt) {
      capacity = vt.load_capacity;
      vehicleName = vt.name;
      fuelRate = vt.fuel_consumption_rate;
      vehicleTs = vt.updated_at;
    }
  }

  const trips = Math.ceil(params.quantity / capacity);

  items.push({
    label: "ประเภทรถ",
    value: vehicleName,
    unit: "",
    source: params.vehicle_type_id ? `vehicle_types.id=${params.vehicle_type_id?.substring(0, 8)}` : "app_configs.vehicle-default-capacity",
    formula: `ความจุ ${capacity} คิว/เที่ยว`,
    timestamp: vehicleTs,
  });

  items.push({
    label: "จำนวนเที่ยว",
    value: trips,
    unit: "เที่ยว",
    source: "คำนวณจากปริมาณ ÷ ความจุรถ",
    formula: `ceil(${params.quantity} ÷ ${capacity}) = ${trips}`,
    timestamp: now,
  });

  // 4. ราคาวัสดุ
  let matPrice = 0;
  let matName = "ไม่ระบุ";
  let matTs = now;

  if (params.material_type_id) {
    const { data: pm } = await supabase()
      .from("pit_materials")
      .select("price, updated_at")
      .eq("pit_profile_id", params.pit_id)
      .eq("material_type_id", params.material_type_id)
      .is("deleted_at", null)
      .limit(1).maybeSingle();

    const { data: mt } = await supabase().from("material_types").select("name").eq("id", params.material_type_id).single();
    matName = mt?.name ?? "ไม่ระบุ";

    if (pm) {
      matPrice = pm.price;
      matTs = pm.updated_at;
    }
  }

  const materialCost = params.quantity * matPrice;

  items.push({
    label: "ราคาวัสดุ/คิว",
    value: matPrice,
    unit: "บาท/คิว",
    source: matPrice > 0 ? `pit_materials (${pit?.pit_name} × ${matName})` : "ยังไม่มีราคาในระบบ",
    formula: matPrice > 0 ? `${matName} ที่ ${pit?.pit_name}` : "ไม่พบราคา — ต้องเพิ่มใน pit_materials",
    timestamp: matTs,
  });

  items.push({
    label: "ค่าวัสดุรวม",
    value: materialCost,
    unit: "บาท",
    source: "คำนวณจากปริมาณ × ราคา/คิว",
    formula: `${params.quantity} × ${matPrice} = ${materialCost.toLocaleString()}`,
    timestamp: now,
  });

  // 5. น้ำมัน
  const fuelPrice = getNum(configs, "fuel-price", 43);
  const roundTripKm = distance * 2;
  const litersPerTrip = roundTripKm / fuelRate;
  const totalLiters = litersPerTrip * trips;
  const fuelCost = Math.round(totalLiters * fuelPrice);

  items.push({
    label: "อัตราสิ้นเปลือง",
    value: fuelRate,
    unit: "กม./ลิตร",
    source: params.vehicle_type_id ? `vehicle_types.fuel_consumption_rate` : "app_configs.default-fuel-consumption",
    formula: `${vehicleName} วิ่งได้ ${fuelRate} กม./ลิตร`,
    timestamp: vehicleTs,
  });

  items.push({
    label: "ราคาน้ำมัน",
    value: fuelPrice,
    unit: "บาท/ลิตร",
    source: "app_configs.fuel-price",
    formula: `ดีเซล ${fuelPrice} บาท/ลิตร`,
    timestamp: now,
  });

  items.push({
    label: "น้ำมันทั้งหมด",
    value: parseFloat(totalLiters.toFixed(1)),
    unit: "ลิตร",
    source: "คำนวณจากระยะทางไป-กลับ × เที่ยว ÷ อัตราสิ้นเปลือง",
    formula: `(${distance.toFixed(1)}×2) ÷ ${fuelRate} × ${trips} = ${totalLiters.toFixed(1)}`,
    timestamp: now,
  });

  items.push({
    label: "ค่าน้ำมันรวม",
    value: fuelCost,
    unit: "บาท",
    source: "คำนวณจากลิตร × ราคา/ลิตร",
    formula: `${totalLiters.toFixed(1)} × ${fuelPrice} = ${fuelCost.toLocaleString()}`,
    timestamp: now,
  });

  // 6. ค่าแรง
  const driverWage = getNum(configs, "driver-wage-per-trip", 450);
  const totalWage = driverWage * trips;

  items.push({
    label: "ค่าแรง/เที่ยว",
    value: driverWage,
    unit: "บาท",
    source: "app_configs.driver-wage-per-trip",
    formula: `คนขับได้ ${driverWage} บาท/เที่ยว`,
    timestamp: now,
  });

  items.push({
    label: "ค่าแรงรวม",
    value: totalWage,
    unit: "บาท",
    source: "คำนวณจากค่าแรง/เที่ยว × เที่ยว",
    formula: `${driverWage} × ${trips} = ${totalWage.toLocaleString()}`,
    timestamp: now,
  });

  // 7. ต้นทุน + ราคาขาย
  const totalCost = materialCost + fuelCost + totalWage;
  const markup = getNum(configs, "pricing-markup-percent", 25);
  const sellingPrice = Math.round(totalCost * (1 + markup / 100));
  const profit = sellingPrice - totalCost;

  items.push({
    label: "ต้นทุนรวม",
    value: totalCost,
    unit: "บาท",
    source: "คำนวณจากค่าวัสดุ + ค่าน้ำมัน + ค่าแรง",
    formula: `${materialCost.toLocaleString()} + ${fuelCost.toLocaleString()} + ${totalWage.toLocaleString()} = ${totalCost.toLocaleString()}`,
    timestamp: now,
  });

  items.push({
    label: "Markup",
    value: markup,
    unit: "%",
    source: "app_configs.pricing-markup-percent",
    formula: `บวกกำไร ${markup}% จากต้นทุน`,
    timestamp: now,
  });

  items.push({
    label: "ราคาขาย",
    value: sellingPrice,
    unit: "บาท",
    source: "คำนวณจากต้นทุน × (1 + markup%)",
    formula: `${totalCost.toLocaleString()} × ${(1 + markup / 100).toFixed(2)} = ${sellingPrice.toLocaleString()}`,
    timestamp: now,
  });

  items.push({
    label: "กำไร",
    value: profit,
    unit: "บาท",
    source: "คำนวณจากราคาขาย - ต้นทุน",
    formula: `${sellingPrice.toLocaleString()} - ${totalCost.toLocaleString()} = ${profit.toLocaleString()}`,
    timestamp: now,
  });

  return {
    items,
    summary: { total_cost: totalCost, selling_price: sellingPrice, profit },
  };
}
