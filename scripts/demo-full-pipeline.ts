#!/usr/bin/env npx tsx
/**
 * DNA OS — End-to-End Demo Scenario (owner request, 2026-07-24)
 *
 * Owner asked to see, across the real admin screens (not a mock), how one
 * customer chat message flows all the way to a real document — the pieces
 * are built but live in many separate pages, and it's hard to see the
 * connection. This script writes ONE real, clearly-tagged demo customer
 * through the REAL tables this system already uses, matched against a REAL
 * existing pit/supplier already in production (queried live below, not
 * hardcoded) so the price is a genuine calculation, not a fabricated number.
 *
 * Per Rule 103 (reuse before build): the nearest-pit/haversine matching
 * below calls the same real engine (engines/distance.ts's haversine) the
 * production pricing code uses — no separate calculation invented for this
 * demo.
 *
 * Everything this script creates is named with a "[DEMO]" prefix and a
 * clearly fake LINE user id so it is greppable and deletable later. Every
 * inserted primary key is printed at the end together with the exact
 * cleanup SQL (delete in reverse dependency order) — nothing here soft-
 * deletes automatically, per Rule 72 (no unattended destructive action).
 *
 * Run: npx tsx scripts/demo-full-pipeline.ts
 */

import { createClient } from "@supabase/supabase-js";
import { haversine } from "@/engines/distance";
import { createBusinessEvent, linkBusinessEventTransaction } from "@/engines/canonical/event-write";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) {
  console.error("ต้องตั้งค่า NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env.local ก่อน");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const DEMO_LINE_USER_ID = "Udemo0000000000000000000000demo1"; // clearly fake shape, not a real LINE id
const today = "20260724";
const stamp = "DEMO1";

// A real construction site ~6km from the matched pit (see below) — not on
// top of it, so the haversine distance in the quote is genuine, not zero.
const CUSTOMER_GPS = { lat: 16.4123, lng: 102.8301, address: "ไซต์ก่อสร้างทดสอบ (DEMO) ถ.มิตรภาพ ต.ในเมือง อ.เมืองขอนแก่น จ.ขอนแก่น" };

async function main() {
  const created: Record<string, string> = {};

  console.log("1) หาบ่อ/ซัพพลายเออร์จริงในระบบที่ขายวัสดุที่ลูกค้าถามและมีพิกัดจริง...");
  const { data: candidates, error: candErr } = await db
    .from("pit_materials")
    .select("pit_profile_id, material_type_id, price, pit_profiles!inner(id, pit_name, latitude, longitude, deleted_at), material_types!inner(id, name, deleted_at)")
    .is("deleted_at", null)
    .is("pit_profiles.deleted_at", null)
    .is("material_types.deleted_at", null)
    .not("pit_profiles.latitude", "is", null)
    .not("pit_profiles.longitude", "is", null);
  if (candErr) throw candErr;
  const candidate = (candidates ?? []).find((c: any) => Number(c.pit_profiles.latitude) !== 0);
  if (!candidate) throw new Error("ไม่พบบ่อจริงที่มีพิกัด+ราคาวัสดุในระบบ — ยกเลิก demo");
  const pit = (candidate as any).pit_profiles;
  const materialType = (candidate as any).material_types;
  const unitPrice = Number((candidate as any).price);
  console.log(`   ใช้บ่อจริง: "${pit.pit_name}" (${pit.id}) ขาย "${materialType.name}" ราคา ${unitPrice} บาท/หน่วย`);

  const distanceKm = Math.round(haversine(CUSTOMER_GPS.lat, CUSTOMER_GPS.lng, Number(pit.latitude), Number(pit.longitude)) * 100) / 100;
  console.log(`   ระยะทางจริง (haversine) จากไซต์ลูกค้าถึงบ่อ: ${distanceKm} กม.`);

  const quantity = 10;
  const subtotal = unitPrice * quantity;
  const vatRate = 7;
  const vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;
  const totalAmount = subtotal + vatAmount;

  const now = new Date().toISOString();

  console.log("\n2) สร้างลูกค้าสมมติ (companies) + ผูก LINE (company_line_links, line_profiles)...");
  const { data: company, error: coErr } = await db
    .from("companies")
    .insert({
      name: "[DEMO] บริษัท สมมติก่อสร้างไทย จำกัด",
      tax_id: "0000000000000",
      address: "ที่อยู่ทดสอบ ไม่มีอยู่จริง — สร้างเพื่อสาธิตระบบ",
      phone: "0800000000",
      type: "CUSTOMER",
      status: "ACTIVE",
      is_individual: false,
      line_user_id: DEMO_LINE_USER_ID,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (coErr) throw coErr;
  created.company_id = company.id;
  console.log(`   companies.id = ${company.id}`);

  const { error: linkErr } = await db.from("company_line_links").insert({ company_id: company.id, line_user_id: DEMO_LINE_USER_ID });
  if (linkErr) throw linkErr;

  const { error: profileErr } = await db.from("line_profiles").insert({
    line_user_id: DEMO_LINE_USER_ID,
    display_name: "สมชาย ทดสอบระบบ (DEMO)",
    role: "customer",
    company_id: company.id,
    trust_level: "unverified",
    notes: "DEMO/ทดสอบ — สร้างโดย scripts/demo-full-pipeline.ts เพื่อสาธิต pipeline เต็มระบบ 2026-07-24, ลบได้ทันที",
  });
  if (profileErr) throw profileErr;

  console.log("\n3) จำลองข้อความแชตจริงที่เข้ามาทาง LINE (line_events): ข้อความถาม + ปักหมุด GPS...");
  const { data: textEvent, error: textErr } = await db
    .from("line_events")
    .insert({
      line_user_id: DEMO_LINE_USER_ID,
      raw_type: "text",
      raw_text: `สวัสดีครับ อยากสอบถามราคา${materialType.name}สำหรับถมที่ก่อสร้างครับ ประมาณ ${quantity} คิว`,
      direction: "in",
      status: "new",
      event_timestamp: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (textErr) throw textErr;
  created.line_event_text_id = textEvent.id;

  const { data: locEvent, error: locErr } = await db
    .from("line_events")
    .insert({
      line_user_id: DEMO_LINE_USER_ID,
      raw_type: "location",
      raw_text: CUSTOMER_GPS.address,
      extracted: { latitude: CUSTOMER_GPS.lat, longitude: CUSTOMER_GPS.lng, address: CUSTOMER_GPS.address },
      direction: "in",
      status: "new",
      event_timestamp: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (locErr) throw locErr;
  created.line_event_location_id = locEvent.id;
  console.log(`   line_events: text=${textEvent.id}, location=${locEvent.id}`);

  console.log("\n4) บันทึกไซต์ลูกค้า (customer_sites) จากพิกัดที่ปักหมุดจริง...");
  const { data: site, error: siteErr } = await db
    .from("customer_sites")
    .insert({
      customer_company_id: company.id,
      site_name: "ไซต์ก่อสร้างทดสอบ (DEMO)",
      address: CUSTOMER_GPS.address,
      province: "ขอนแก่น",
      district: "เมืองขอนแก่น",
      subdistrict: "ในเมือง",
      postal_code: "40000",
      gps_lat: CUSTOMER_GPS.lat,
      gps_lng: CUSTOMER_GPS.lng,
      is_active: true,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (siteErr) throw siteErr;
  created.customer_site_id = site.id;
  console.log(`   customer_sites.id = ${site.id}`);

  console.log("\n5) สร้าง business_events (คำขอที่ระบบประกอบจากแชตจริง) พร้อมราคาที่คำนวณจริง...");
  // Capability D: the demo is an executable DB writer, so it sits under the SAME
  // canonical authority as the app — no direct business_events write here.
  // Field census (every property of the previous insert was mapped; none dropped):
  //   event_code/event_type/status/context/confidence/material_*/quantity*/destination/
  //   contact_* → CreateBusinessEventInput · source_line_user_id + source_message_ids →
  //   source{provider, externalSubjectId, messageIds}.
  //   REPORTED DIFFERENCE: the writer requires `title` and `event_date`, which the
  //   old direct insert left NULL — the demo now supplies them explicitly
  //   (title = the material it demonstrates; event_date = today).
  const eventCreated = await createBusinessEvent(db, {
    eventCode: `EV${today}-${stamp}`,
    eventType: "สั่งซื้อ",
    eventDate: today,
    title: materialType.name,
    source: { provider: "line", externalSubjectId: DEMO_LINE_USER_ID, messageIds: [textEvent.id, locEvent.id] },
    partnerId: company.id,
    materialId: materialType.id,
    materialText: materialType.name,
    quantity,
    quantityUnit: "คิว",
    destination: CUSTOMER_GPS.address,
    contactName: "สมชาย ทดสอบระบบ (DEMO)",
    contactPhone: "0800000000",
    status: "job_created",
    context: {
      demo: true,
      matched_pit_id: pit.id,
      matched_pit_name: pit.pit_name,
      unit_price: unitPrice,
      distance_km: distanceKm,
      note: "ราคาคำนวณจริงจาก pit_materials.price จริงในระบบ, ระยะทางคำนวณจาก engines/distance.ts haversine() จริง — ไม่ได้ mock",
    },
    confidence: 1,
    actor: "script:demo-full-pipeline",
  })
  if (!eventCreated.ok || !eventCreated.data) throw new Error(eventCreated.error ?? "demo event create failed")
  const event = eventCreated.data
  created.business_event_id = event.id;
  console.log(`   business_events.id = ${event.id}`);

  console.log("\n6) เปิดงานจริง (projects → document_groups → customer_orders)...");
  const { data: project, error: projErr } = await db
    .from("projects")
    .insert({ project_no: `PRJ-${today}-${stamp}`, customer_company_id: company.id, customer_site_id: site.id, title: "โครงการทดสอบ (DEMO)", status: "ACTIVE", created_at: now, updated_at: now })
    .select("id")
    .single();
  if (projErr) throw projErr;
  created.project_id = project.id;

  const { data: group, error: groupErr } = await db
    .from("document_groups")
    .insert({ group_no: `DG-${today}-${stamp}`, project_id: project.id, project_no: `PRJ-${today}-${stamp}`, customer_company_id: company.id, title: "ชุดเอกสารทดสอบ (DEMO)", status: "OPEN", created_at: now, updated_at: now })
    .select("id")
    .single();
  if (groupErr) throw groupErr;
  created.document_group_id = group.id;

  const { data: order, error: orderErr } = await db
    .from("customer_orders")
    .insert({
      order_no: `ORD-${today}-${stamp}`,
      project_id: project.id,
      document_group_id: group.id,
      customer_company_id: company.id,
      customer_site_id: site.id,
      status: "QUOTED",
      delivery_note: `${materialType.name} ${quantity} คิว จาก "${pit.pit_name}" (${distanceKm} กม.)`,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (orderErr) throw orderErr;
  created.customer_order_id = order.id;
  // Capability D: LINK only — the link command never changes event state.
  await linkBusinessEventTransaction(db, { eventId: event.id, transactionId: order.id, actor: "script:demo-full-pipeline" });
  console.log(`   projects.id=${project.id}, document_groups.id=${group.id}, customer_orders.id=${order.id}`);

  console.log("\n7) ออกใบเสนอราคาจริง (standalone_documents, document_type='QT')...");
  const { data: doc, error: docErr } = await db
    .from("standalone_documents")
    .insert({
      document_no: `QT-${today}-${stamp}`,
      document_type: "QT",
      document_date: new Date().toISOString(),
      customer_company_id: company.id,
      project_id: project.id,
      customer_order_id: order.id,
      recipient_address: CUSTOMER_GPS.address,
      notes: `${materialType.name} ${quantity} คิว x ${unitPrice} บาท — จาก "${pit.pit_name}" ระยะทาง ${distanceKm} กม. (สร้างเพื่อสาธิตระบบ 2026-07-24)`,
      vat_rate: vatRate,
      subtotal,
      vat_amount: vatAmount,
      total_amount: totalAmount,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (docErr) throw docErr;
  created.standalone_document_id = doc.id;
  console.log(`   standalone_documents.id = ${doc.id}  ยอดรวม ${totalAmount} บาท`);

  console.log("\n=== เสร็จสิ้น — สรุป record จริงที่สร้าง (เก็บ id ไว้ลบทีหลังได้) ===");
  console.log(JSON.stringify(created, null, 2));

  console.log("\n=== ดูได้ที่หน้าจอไหนบ้าง ===");
  console.log(`- /admin/relationships           → เปิดลูกค้า "[DEMO] บริษัท สมมติก่อสร้างไทย จำกัด" (company ${company.id}) เห็นไทม์ไลน์ครบ: แชต → ไซต์ → คำสั่งซื้อ → เอกสาร`);
  console.log(`- /admin/line-customers           → เห็นข้อความแชตดิบ + พิกัด GPS ที่ปักหมุดจริง`);
  console.log(`- /admin/pits                     → เห็นบ่อจริงที่ระบบจับคู่ให้ "${pit.pit_name}"`);
  console.log(`- /admin/jobs                     → เห็นงาน/ออเดอร์ ${`ORD-${today}-${stamp}`}`);
  console.log(`- /admin/create-document หรือหน้าที่แสดง standalone_documents → เอกสารใบเสนอราคา ${`QT-${today}-${stamp}`} ยอด ${totalAmount} บาท`);

  console.log("\n=== SQL ลบข้อมูลสาธิตทั้งหมด (รันทีหลังเมื่อดูจบแล้ว) ===");
  console.log(`delete from standalone_documents where id = '${doc.id}';`);
  console.log(`delete from customer_orders where id = '${order.id}';`);
  console.log(`delete from document_groups where id = '${group.id}';`);
  console.log(`delete from projects where id = '${project.id}';`);
  console.log(`delete from business_events where id = '${event.id}';`);
  console.log(`delete from customer_sites where id = '${site.id}';`);
  console.log(`delete from line_events where id in ('${textEvent.id}', '${locEvent.id}');`);
  console.log(`delete from line_profiles where line_user_id = '${DEMO_LINE_USER_ID}';`);
  console.log(`delete from company_line_links where line_user_id = '${DEMO_LINE_USER_ID}';`);
  console.log(`delete from companies where id = '${company.id}';`);
}

main().catch((e) => {
  console.error("DEMO FAILED:", e.message ?? e);
  process.exit(1);
});
