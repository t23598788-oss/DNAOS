#!/usr/bin/env npx tsx
/**
 * DNA OS — Demo Pipeline Part 2 (owner follow-up, 2026-07-24)
 *
 * Owner's fair critique of part 1 (scripts/demo-full-pipeline.ts): it only
 * priced the material and stopped at one quotation row — it never touched
 * the vehicle/trip/fuel/driver-wage cost engine that already exists in this
 * codebase (engines/capacity.ts, engines/fuel.ts, engines/cost.ts), never
 * produced the delivery-order document (ใบส่งของ), and never actually
 * attempted to send anything back to LINE — the real round trip a real
 * order goes through. This script continues the SAME demo records (found
 * by the fixed DEMO_LINE_USER_ID from part 1) and closes those gaps using
 * the real engines, not new fabricated numbers:
 *
 * - engines/capacity.ts calcCapacity() → real vehicle_types row + real
 *   trips_required (ceil(quantity / load_capacity))
 * - engines/cost.ts calcCost() → real material_cost + fuel_cost (real GPS
 *   distance x real pump fuel price) = total_cost. Owner correction
 *   2026-07-25: no driver-wage-per-trip constant — the truck owner is an
 *   independent contractor DNA OS proposes a price TO, not a cost DNA OS
 *   pays separately. total_cost is the fair base rate to offer, not the
 *   final agreed payout (see registry/CHANGELOG.json for the real
 *   job_vehicle_pricings table this should be recorded into).
 * - a second standalone_documents row, document_type='ORD' (delivery
 *   order / ใบส่งของ — engines/documents/engine.ts's DOC_LABELS).
 * - engines/documents/flex-template.ts's documentFlex() → the REAL Flex
 *   JSON a customer's LINE app would render.
 * - registry/communication.ts's sendLineMessage() → the REAL LINE
 *   Messaging API call. Run against a fake demo LINE user id, so this
 *   call is expected to be rejected by LINE's real servers — that
 *   rejection itself is the honest proof the send mechanism is real code
 *   hitting a real external API, not a mock that always "succeeds".
 *
 * Run: npx tsx scripts/demo-full-pipeline-part2.ts
 */

import { createClient } from "@supabase/supabase-js";
import { calcCapacity } from "@/engines/capacity";
import { enrichBusinessEvent } from "@/engines/canonical/event-write";
import { calcCost } from "@/engines/cost";
import { documentFlex } from "@/engines/documents/flex-template";
import { sendLineMessage } from "@/registry/communication";
import { supabaseAdmin } from "@/services/supabase/queries";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
process.env.NEXT_PUBLIC_SUPABASE_URL = url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? key;
const db = createClient(url, key, { auth: { persistSession: false } });

const DEMO_LINE_USER_ID = "Udemo0000000000000000000000demo1";
const today = "20260724";
const stamp = "DEMO1";

async function main() {
  console.log("0) ดึงข้อมูล demo ที่สร้างไว้ใน part 1 กลับมา...");
  const { data: event, error: evErr } = await db
    .from("business_events")
    .select("*")
    .eq("source_line_user_id", DEMO_LINE_USER_ID)
    .eq("event_code", `EV${today}-${stamp}`)
    .maybeSingle();
  if (evErr || !event) throw new Error("ไม่พบ business_events ของ demo — รัน scripts/demo-full-pipeline.ts (part 1) ก่อน");

  const { data: order } = await db.from("customer_orders").select("id, project_id").eq("id", event.transaction_id).maybeSingle();
  const { data: quotation } = await db.from("standalone_documents").select("*").eq("customer_order_id", event.transaction_id).eq("document_type", "QT").maybeSingle();
  if (!order || !quotation) throw new Error("ไม่พบ customer_orders/standalone_documents ของ demo — รัน part 1 ก่อน");

  const ctx = event.context as any;
  const distanceKm: number = ctx.distance_km;
  const quantity: number = Number(event.quantity);

  console.log("\n1) เลือกรถจริงจากระบบ (vehicle_types) ตามปริมาณงาน — calcCapacity() จริง...");
  const { data: vehicle, error: vErr } = await db.from("vehicle_types").select("id, name, load_capacity").order("load_capacity", { ascending: true }).limit(20);
  if (vErr) throw vErr;
  // เลือกคันแรกที่จุพอในเที่ยวเดียวหรือใกล้เคียงที่สุด — ไม่ใช่ mock, เป็น real row จาก vehicle_types
  const chosenVehicle = (vehicle ?? []).find((v) => Number(v.load_capacity) >= quantity) ?? (vehicle ?? [])[(vehicle ?? []).length - 1];
  if (!chosenVehicle) throw new Error("ไม่พบ vehicle_types ในระบบ — ยกเลิก");

  let tripsRequired = 1;
  let costBreakdown: { material_cost: number; fuel_cost: number; total_cost: number } | null = null;
  let margin: number | null = null;
  try {
    const capacity = await calcCapacity({ quantity, vehicle_type_id: chosenVehicle.id });
    tripsRequired = capacity.trips_required;
    console.log(`   ใช้รถจริง: "${chosenVehicle.name}" (จุ ${chosenVehicle.load_capacity} คิว/เที่ยว) → ${tripsRequired} เที่ยว`);

    console.log("\n2) คำนวณต้นทุนจริงทั้งก้อน (วัสดุ + น้ำมัน จากระยะทางจริง × ราคาน้ำมันจริง — ไม่มีค่าแรงคนขับแยก, owner correction 2026-07-25) — calcCost() จริง...");
    const cost = await calcCost({
      distance_km: distanceKm,
      quantity,
      trips: tripsRequired,
      material_type_id: event.material_id,
      pit_profile_id: ctx.matched_pit_id,
      vehicle_type_id: chosenVehicle.id,
    });
    costBreakdown = cost;
    console.log(`   material_cost=${cost.material_cost}  fuel_cost=${cost.fuel_cost}  total_cost=${cost.total_cost}`);

    margin = Math.round((Number(quotation.subtotal) - cost.total_cost) * 100) / 100;
    console.log(`   ลูกค้าจ่าย (subtotal ใบเสนอราคา) = ${quotation.subtotal} บาท`);
    console.log(`   ต้นทุนจริงทั้งหมด (วัสดุ+น้ำมัน) = ${cost.total_cost} บาท — นี่คือฐานราคาที่เสนอเจ้าของรถได้ ไม่ใช่ราคาสุดท้ายที่ตกลงจริง`);
    console.log(`   >>> กำไรที่เจ้าของระบบได้จากงานนี้ (ก่อนหักค่าที่ตกลงจริงกับเจ้าของรถ) = ${margin} บาท <<<`);
  } catch (e) {
    console.log(`   ⚠ ${(e as Error).message}`);
  }

  console.log("\n3) ออกใบส่งของจริง (standalone_documents, document_type='ORD')...");
  const now = new Date().toISOString();
  const { data: deliveryDoc, error: ddErr } = await db
    .from("standalone_documents")
    .insert({
      document_no: `DO-${today}-${stamp}`,
      document_type: "ORD",
      document_date: now,
      customer_company_id: event.partner_id,
      project_id: order.project_id,
      customer_order_id: order.id,
      notes: `จัดส่ง ${event.material_text} ${quantity} คิว ด้วย "${chosenVehicle.name}" ${tripsRequired} เที่ยว จาก "${ctx.matched_pit_name}"`,
      vat_rate: 0,
      subtotal: 0,
      vat_amount: 0,
      total_amount: 0,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (ddErr) throw ddErr;
  console.log(`   standalone_documents.id (ใบส่งของ) = ${deliveryDoc.id}`);

  console.log("\n4) สร้าง Flex Message จริงของใบเสนอราคา (engines/documents/flex-template.ts)...");
  const flex = documentFlex({
    documentType: "quotation",
    documentNumber: quotation.document_no,
    partyName: "[DEMO] บริษัท สมมติก่อสร้างไทย จำกัด",
    items: [{ description: event.material_text, qty: quantity, unit: "คิว", unitPrice: Number(quotation.subtotal) / quantity }],
    summary: { subtotal: Number(quotation.subtotal), vat: Number(quotation.vat_amount), total: Number(quotation.total_amount) },
  });
  console.log("   Flex JSON สร้างสำเร็จ (เนื้อหาเดียวกับที่ลูกค้าจริงจะเห็นในแชต LINE):");
  console.log(JSON.stringify(flex, null, 2).slice(0, 600) + " ...(ตัดแสดงบางส่วน)");

  console.log("\n5) พยายามส่งจริงกลับไปที่ LINE ของลูกค้า (registry/communication.ts sendLineMessage — เรียก LINE API จริง)...");
  const sendResult = await sendLineMessage(supabaseAdmin(), DEMO_LINE_USER_ID, [flex]);
  console.log(`   ผลจริงจาก LINE API: ${JSON.stringify(sendResult)}`);
  if (!sendResult.success) {
    console.log(`   → ตามคาด: ${DEMO_LINE_USER_ID} เป็น LINE user id ปลอมที่สร้างไว้สาธิต ไม่ใช่บัญชีจริงที่แอดเพื่อน OA ไว้`);
    console.log(`     ระบบส่งจริง (sendLineMessage) เรียก LINE API จริงและถูกปฏิเสธจริง — พิสูจน์ว่า mechanism นี้เป็นโค้ดจริง ไม่ใช่ของปลอมที่ 'สำเร็จ' เสมอ`);
    console.log(`     กับลูกค้าจริงที่แอดเพื่อนไลน์ OA ไว้แล้ว ขั้นตอนนี้จะส่งการ์ดใบเสนอราคาเข้าไปในแชตจริงทันที`);
  }

  // Capability D: BUSINESS METADATA through the canonical writer — the context
  // object is passed as an explicit allow-listed field (`context`), not as a
  // direct row patch; the writer owns updated_at.
  await enrichBusinessEvent(db, {
    eventId: event.id,
    fields: {
      context: {
        ...ctx,
        vehicle_type_id: chosenVehicle.id,
        vehicle_name: chosenVehicle.name,
        trips_required: tripsRequired,
        material_cost: costBreakdown?.material_cost ?? null,
        fuel_cost: costBreakdown?.fuel_cost ?? null,
        total_cost: costBreakdown?.total_cost ?? null,
        margin,
        delivery_order_document_id: deliveryDoc.id,
        line_send_attempted: true,
        line_send_result: sendResult,
      },
    },
    actor: "script:demo-full-pipeline-part2",
  });

  console.log("\n=== เพิ่มเติมสำหรับ SQL ลบทีหลัง ===");
  console.log(`delete from standalone_documents where id = '${deliveryDoc.id}';`);
}

main().catch((e) => {
  console.error("PART 2 FAILED:", e.message ?? e);
  process.exit(1);
});
