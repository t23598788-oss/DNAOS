// Closes the real gap diagnosed 2026-07-11: the admin "ถาม AI" box on
// /admin/line-customers couldn't answer material-price questions at all,
// because it only talked to cognitive/pipeline.ts (generic intents: view
// customer/debt/create document) — completely disconnected from the real
// pricing engine the LINE bot itself uses to answer customers
// (supabase/functions/line-webhook-v2/engines/quote-price.ts, Deno).
//
// This is the Next.js-side equivalent, but reuses the real engines already
// on this side instead of re-deriving them: findNearestPit (engines/distance.ts)
// and resolveMaterial (engines/material-resolver.ts). Material price only —
// no vehicle/trip/transport calc, same "ไม่ต้องไล่รถ" constraint as the LINE
// bot version. Never invents a price: if no pit sells the material, or GPS
// is unknown, says so plainly instead of guessing.

import { supabase } from "@/services/supabase/queries";
import { findNearestPit } from "./distance";
import { resolveMaterial, type MaterialTypeRow } from "./material-resolver";

export async function tryQuoteMaterialPrice(
  materialText: string,
  quantity: number,
  gps: { lat: number; lng: number } | null
): Promise<string> {
  const { data: materialTypes } = await supabase().from("material_types").select("id, name");
  const match = resolveMaterial(materialText, (materialTypes ?? []) as MaterialTypeRow[]);
  if (!match.matched) {
    return match.candidates.length > 0
      ? `ไม่แน่ใจว่าหมายถึงวัสดุไหนครับ (${match.candidates.map((c) => c.name).join(", ")}) รบกวนระบุให้ชัดเจนกว่านี้ครับ`
      : "เดี๋ยวขอเช็ควัสดุให้ชัดเจนอีกครั้งครับ";
  }
  const material = match.matched;

  if (!gps) return "ยังไม่มีพิกัดของลูกค้าคนนี้ในระบบครับ รบกวนขอพิกัดก่อนถึงจะแจ้งราคาได้";

  const { nearest_pit } = await findNearestPit(gps.lat, gps.lng, material.id);
  if (!nearest_pit) {
    return `ขออภัยครับ ตอนนี้ยังไม่มีบ่อไหนในระบบตั้งราคา "${material.name}" ไว้ เดี๋ยวเช็คให้แล้วแจ้งกลับครับ`;
  }

  const { data: priceRow } = await supabase()
    .from("pit_materials")
    .select("price")
    .eq("pit_profile_id", nearest_pit.id)
    .eq("material_type_id", material.id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  const unitPrice = Number(priceRow?.price);
  if (!unitPrice) return "เดี๋ยวแจ้งราคากลับไปครับ ขอเช็คราคาก่อนนะครับ";

  const total = unitPrice * quantity;

  return `${material.name} ที่บ่อ "${nearest_pit.name}" (ห่างประมาณ ${nearest_pit.distance_km.toFixed(1)} กม.) ราคา ${unitPrice.toLocaleString()} บาท/คิว รวม ${quantity} คิว = ${total.toLocaleString()} บาท (ยังไม่รวมค่าขนส่งครับ)`;
}
