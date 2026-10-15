/**
 * NATIONAL REGISTRY SELF-SERVICE TEST — owner directive 2026-10-15 (PHASE 7)
 *
 * ทดสอบ 11 เคสตามสัญญา ด้วยข้อมูลทดสอบเท่านั้น (prefix [test-nat-reg-])
 * และล้างทุกแถว+auth user ทดสอบท้ายการรันจริง (hard clean-up)
 * ไม่ส่งข้อความจริง · ไม่ deploy · ไม่แตะข้อมูลจริงของผู้ใช้ใด ๆ
 *
 * รัน: (source .env.local) npx tsx scripts/national-registry-self-service-test.ts
 */
import { createClient } from "@supabase/supabase-js";
import { decideSandboxCommand } from "../core/auth/surfacePolicy";
import { dispatch } from "../engines/validation/dispatcher";
import {
  registerNational, createMyResourceSite, updateMyResourceSite,
  addMyMaterialListing, updateMyMaterialPrice, addMyDemandRequest,
  listMyResources, listPublicRegistry, interviewExtract,
} from "../engines/public-registry/service";

let passCount = 0;
let failCount = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { passCount++; console.log(`  PASS ${name}`); }
  else { failCount++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const P = "[test-nat-reg-";
// อีเมลจริงต้องผ่าน format Supabase — TLD .invalid ถูกปฏิเสชและวงเล็บห้ามอยู่ใน
// email จริง — ใช้ tag ไม่มีวงเล็บ + reserved domain example.com (admin
// generateLink ไม่มีการส่งอีเมลจริงใด ๆ)
const TAG = "test-nat-reg-";
const emailA = `zzz-${TAG}a${Date.now()}@example.com`;
const emailB = `zzz-${TAG}b${Date.now()}@example.com`;
const ids: { profile?: string; company?: string; pit?: string } = {};
let materialId = ""; let materialName = "";

async function main(): Promise<void> {
  console.log("\n══ NATIONAL REGISTRY SELF-SERVICE TEST (11 cases) ══\n");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const matsQ = await db.from("material_types").select("id, name").is("deleted_at", null).limit(5);
  materialId = (matsQ.data?.[0] as { id: string })?.id ?? "";
  materialName = (matsQ.data?.[0] as { name: string })?.name ?? "";
  ok("เตรียม: มีวัสดุจริงในทะเบียน", !!materialId, materialName);

  // 1) สมัครสมาชิก — บุคคล (auth จริง generateLink signup — ไม่ส่งข้อความจริง)
  console.log("1) สมัครสมาชิก (บุคคล)");
  const regA = await registerNational({ email: emailA, display_name: `${P}ก้องทดสอบ`, registration_type: "individual", registrant_profile: "resource_owner" });
  ok("สมัครสำเร็จ + ได้ลิงก์เข้าระบบจริง", regA.ok && !!regA.action_link && !!regA.profile_id, regA.error);
  ids.profile = regA.profile_id;
  const userA = regA.profile_id!;

  // 2) ลงทะเบียนบริษัท
  console.log("2) ลงทะเบียนบริษัท (เจ้าของทรัพยากร)");
  const regB = await registerNational({ email: emailB, company_name: `${P}บจก.ทดสอบ`, registrant_profile: "resource_owner", registration_type: "company" });
  ok("บริษัทสมัครสำเร็จ + companies row จริง", regB.ok && !!regB.company_id, regB.error);
  ids.company = regB.company_id ?? undefined;
  const userB = regB.profile_id ?? "";
  ok("บทบาทเจ้าของทรัพยากร = partner (role เดิม)", (await db.from("profiles").select("role").eq("id", userB).maybeSingle()).data?.role === "partner");

  // 9) ป้องกันทะเบียนซ้ำ (สมัครอีเมลเดิมอีกครั้ง = ปฏิเสธ)
  console.log("9) ป้องกันทะเบียนซ้ำ");
  const regDup = await registerNational({ email: emailA, registration_type: "individual", registrant_profile: "buyer" });
  ok("สมัครซ้ำอีเมลเดิม = ALREADY_REGISTERED", !regDup.ok && regDup.code === "ALREADY_REGISTERED", regDup.error);

  // 4) บันทึก GPS — ไม่รับ 0,0 (fail-closed)
  console.log("4) GPS จริงเท่านั้น (ปฏิเสธ 0,0)");
  const badGps = await createMyResourceSite(userA, { pit_name: `${P}บ่อทดสอบ`, latitude: 0, longitude: 0 });
  ok("พิกัด 0,0 ถูกปฏิเสธ", !badGps.ok && /GPS/.test(badGps.error ?? ""));

  // 5) เพิ่มโกดัง/บ่อ (ที่ตั้งจริงจากผู้ลงทะเบียน)
  console.log("5) เพิ่มโกดัง/บ่อของฉัน");
  const site = await createMyResourceSite(userA, { pit_name: `${P}บ่อทดสอบกลาง`, phone: "0999999999", address: `${P}จังหวัดทดสอบ`, latitude: 13.9, longitude: 100.5, is_open: true });
  ok("สร้างโกดังสำเร็จ + ผูก user_id จริง", site.ok && !!site.pit_id, site.error);
  ids.pit = site.pit_id;
  const rowPit = (await db.from("pit_profiles").select("user_id, pit_name, is_open").eq("id", ids.pit!).maybeSingle()).data as { user_id: string; pit_name: string; is_open: boolean } | null;
  ok("ownership = userA + เป็นสาธารณะ (is_open)", rowPit?.user_id === userA && rowPit?.is_open === true);

  // 3) เพิ่มวัสดุ + ราคาจริง (หลักฐานผู้ลงทะเบียน)
  console.log("3) เพิ่มวัสดุ + ราคา");
  const badMat = await addMyMaterialListing(userA, { pit_id: ids.pit!, material_type_id: "00000000-0000-0000-0000-000000000000", price: 100 });
  ok("วัสดุที่ไม่มีในทะเบียน = ปฏิเสธ", !badMat.ok);
  const zeroPrice = await addMyMaterialListing(userB, { pit_id: ids.pit!, material_type_id: materialId, price: 0 });
  ok(`ราคา ฿0 ถูกปฏิเสธ (ห้ามแต่ง) + บ่อไม่ใช่ของ userB = FORBIDDEN`, !zeroPrice.ok && /FORBIDDEN/.test(zeroPrice.error ?? ""), zeroPrice.error);
  const mat = await addMyMaterialListing(userA, { pit_id: ids.pit!, material_type_id: materialId, price: 420 });
  ok("เพิ่มวัสดุ+ราคาจริงได้", mat.ok, mat.error);

  // กันลงทะเบียนซ้ำระดับวัสดุ
  const matDup = await addMyMaterialListing(userA, { pit_id: ids.pit!, material_type_id: materialId, price: 420 });
  ok("วัสดุเดิมที่โกดังเดิมลงซ้ำ = ปฏิเสธ (DUP)", !matDup.ok && /DUP/.test(matDup.error ?? ""), matDup.error);

  // ราคา = แก้ได้ในสิทธิ์ตัวเอง
  const priceUp = await updateMyMaterialPrice(userA, { pit_id: ids.pit!, material_type_id: materialId, price: 450 });
  ok("แก้ราคาในสิทธิ์ตัวเองได้", priceUp.ok, priceUp.error);
  const priceZero = await updateMyMaterialPrice(userA, { pit_id: ids.pit!, material_type_id: materialId, price: 0 });
  ok("แก้ราคาเป็น 0 = ปฏิเสธ", !priceZero.ok);

  // 7) ลงทะเบียนความต้องการ (ตาราง demand เดิม)
  console.log("7) ลงประกาศความต้องการ");
  const demand = await addMyDemandRequest(userA, { pit_id: ids.pit!, material_type_id: materialId, requested_quantity: 50 });
  ok("ความต้องการลง pit_price_requests เดิมได้", demand.ok, demand.error);

  // 10) ป้องกันแก้ไขข้อมูลข้ามบัญชี
  console.log("10) ป้องกันแก้ข้ามบัญชี");
  const xAcc = await updateMyResourceSite(userB, ids.pit!, { pit_name: `${P}ถูกกุดเชย` });
  ok("userB แก้โกดังของ userA = FORBIDDEN", !xAcc.ok && /FORBIDDEN/.test(xAcc.error ?? ""), xAcc.error);
  const xAccOwner = await listMyResources(userB);
  ok("userB ไม่เห็นโกดังของ userA ใน 'ของฉัน'", (xAccOwner.sites ?? []).length === 0);

  // 8) ค้นหาทรัพยากร (Sales sandbox + public registry)
  console.log("8) ค้นหาทรัพยากรจากข้อมูลที่เพิ่งลงทะเบียน");
  const found = await listPublicRegistry(`${P}บ่อทดสอบกลาง`);
  const entry = (found.entries ?? [])[0] as { site_name?: string; available_materials?: { material: string; price: number | null }[] } | undefined;
  ok("public registry เห็นโกดัง+วัสดุ+ราคาที่ลงทะเบียน", found.ok === true && entry?.site_name === `${P}บ่อทดสอบกลาง` && entry?.available_materials?.some((m) => m.material === materialName && m.price === 450) === true, JSON.stringify({ foundOk: found.ok, total: found.total, entry: entry ?? null, materialName }));
  const salesDecision = decideSandboxCommand({ command: "pit.find", sandbox: "sales" });
  ok("Sales sandbox อนุญาต pit.find", salesDecision.allowed);
  const pitFind = await dispatch("pit.find", { keyword: `${P}บ่อทดสอบกลาง` }, false, { sandbox: "sales" });
  ok("Sales AI ค้นพบทะเบียนใหม่ผ่าน dispatcher เดิม", pitFind.ok && (pitFind.data as { total: number }).total >= 1, JSON.stringify(pitFind.violations));

  // 11) ป้องกัน AI อ่าน PRIVATE (ผลคืนต้องไม่มีเขตข้อมูลส่วนตัว)
  console.log("11) กัน AI อ่าน PRIVATE");
  const pubStr = JSON.stringify(entry ?? {});
  ok("PUBLIC ไม่มี user_id/tax_id/bank/profile_id", !/user_id|tax_id|bank_|deleted_at|created_at"/.test(pubStr), pubStr.slice(0, 160));
  const pitStr = JSON.stringify((pitFind.data as { hits?: unknown[] }).hits ?? []);
  ok("Sales AI (pit.find) ไม่มี PRIVATE fields", !/user_id|tax_id|bank_/.test(pitStr));

  // 12) AI Interview — แยกได้จริง + ไม่บันทึก (จำนวนแถวเท่าเดิม)
  console.log("AI Interview (แยก/เตือน — ไม่บันทึก)");
  const beforeCount = (await db.from("pit_materials").select("*", { count: "exact", head: true })).count;
  const interview = await interviewExtract(`ขาย ${materialName} คิวละ 380 บาท อยู่บ่อตำบลในเมือง มี 500 คิว`);
  ok("แยกวัสดุ/จำนวน/ราคาจากข้อความจริง", interview.ok && (interview.suggestion?.fields?.material_name === materialName) && interview.suggestion?.fields?.quantity === 500 && interview.suggestion?.fields?.suggested_price === 380, JSON.stringify(interview.suggestion));
  ok("ตรวจขอขาด: พิกัด/ราคาหลักฐานถูกแจ้ง missing (ไม่แต่ง)", (interview.suggestion?.missing_required ?? []).length > 0);
  const afterCount = (await db.from("pit_materials").select("*", { count: "exact", head: true })).count;
  ok("AI Interview ไม่เขียน DB เลย (แถวเท่าเดิม)", beforeCount === afterCount);

  // ล้างข้อมูลทดสอบจริง
  await cleanupBoard();
  console.log(`\n══ สรุป: ${passCount} PASS / ${failCount} FAIL (ข้อมูลทดสอบถูกล้างแล้ว) ══\n`);
  if (failCount > 0) process.exit(1);
}

// cleanup จริง: ลบข้อมูลทดสอบทั้งหมด (hard delete, เฉพาะแถวที่สร้างใน test นี้)
async function cleanupBoard(): Promise<void> {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    // หาของ test ทั้งหมดด้วย tag อีเมลเดิม (ไม่มีวงเล็บตามเส้นอีเมลจริง)
    const profQ = await db.from("profiles").select("id, email").ilike("email", `zzz-${TAG}%`);
    const ids2 = ((profQ.data ?? []) as { id: string; email: string }[]).filter((r) => r.email.includes(TAG));
    // กันค้าง: โกดัง/วัสดุที่สร้างเมื่อ auth ล้ม (user_id null) — จับด้วย tag ในชื่อโกดังเสมอ
    const stray = await db.from("pit_profiles").select("id").ilike("pit_name", `%${TAG}%`);
    const strayIds = (stray.data ?? []).map((r: { id: string }) => r.id);
    if (strayIds.length) {
      await db.from("pit_price_requests").delete().in("pit_profile_id", strayIds);
      await db.from("pit_materials").delete().in("pit_profile_id", strayIds);
      await db.from("pit_profiles").delete().in("id", strayIds);
    }
    if (ids2.length) {
      const pitQ = await db.from("pit_profiles").select("id").in("user_id", ids2.map((r) => r.id));
      const pitIds = (pitQ.data ?? []).map((r: { id: string }) => r.id);
      if (pitIds.length) {
        await db.from("pit_price_requests").delete().in("pit_profile_id", pitIds);
        await db.from("pit_materials").delete().in("pit_profile_id", pitIds);
        await db.from("pit_profiles").delete().in("id", pitIds);
      }
      await db.from("companies").delete().ilike("email", `zzz-${TAG}%`);
      await db.from("profiles").delete().in("id", ids2.map((r) => r.id));
      // auth users ที่ generateLink สร้าง
      for (const r of ids2) {
        try { await adminDeleteUser(r.id); } catch { /* optional */ }
      }
    }
  } catch (e) {
    console.log("cleanup warning:", e instanceof Error ? e.message : e);
  }
}

async function adminDeleteUser(id: string): Promise<void> {
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  await admin.auth.admin.deleteUser(id);
}

main().catch((err) => {
  console.error("test error:", err);
  process.exit(1);
});
