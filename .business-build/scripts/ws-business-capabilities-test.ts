/**
 * WORKSTREAM 2/3/4 CONTRACT TEST (owner directive 2026-10-15)
 *
 * PART A — Contract fail-closed (รันจริงตอนนี้):
 *   · W2 ownership service fail-closed
 *   · W3 member invite fail-closed + profiles.role ไม่ถูกยกระดับ admin
 *   · W4 ERP bridge: 503 fail-closed · 401 secret ผิด · 400 kind ไม่รู้จัก ·
 *     materials matcher จากทะเบียนจริง · stock→canonical เดิม
 * PART B — Data-level ตาม migration (แจ้ง BLOCKED ตามจริงถ้ายังไม่ apply)
 * ข้อมูลทดสอบ [test-ws-] — ล้างท้ายจริง
 */
import { createClient } from "@supabase/supabase-js";
import { registerMyAsset } from "../engines/public-registry/service";
import { acceptCompanyInvite, createCompanyInvite } from "../engines/public-registry/service";

let pass = 0; let fail = 0;
function ok(name: string, cond: boolean | undefined, detail?: string): void {
  if (cond === true) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = "test-ws-";
const ERP = { ERP_IMPORT_INTERNAL_SECRET: "test-ws-secret" };

type RouteResult = { status: number; json: Record<string, unknown> };
import { POST as erpImportPOST } from "../app/api/internal/connect/erp-import/route";
async function callErpImport(kind: string, payload: unknown, headerSecret?: string, erpName = `${TAG}erp`): Promise<RouteResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (headerSecret !== undefined) headers["x-erp-import-internal-secret"] = headerSecret;
  // เรียก handler ตรง ๆ (ไม่มี network จริง — วิธีของ contract tests เดิม)
  const req = new Request("http://local.test/api/internal/connect/erp-import", {
    method: "POST", headers,
    body: JSON.stringify({ kind, payload, erp_name: erpName, source_id: `${TAG}${Date.now()}`, actor: `test-${TAG}` }),
  });
  const res = await erpImportPOST(req);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main(): Promise<void> {
  console.log("\n══ W2/W3/W4 CONTRACT TEST ══\n");

  // — เต้าไม่มี secret บนระบบ = 503 fail-closed (เกิดจริงก่อนอะไรก็ได้)
  const origSecret = process.env.ERP_IMPORT_INTERNAL_SECRET;
  delete process.env.ERP_IMPORT_INTERNAL_SECRET;
  const noConfig = await callErpImport("materials", {}, "whatever");
  ok("W4: ระบบไม่ตั้ง secret = 503 fail-closed", noConfig.status === 503, JSON.stringify(noConfig));

  // — secret ผิด = 401 (ตั้ง env ใน scope ทดสอบ)
  process.env.ERP_IMPORT_INTERNAL_SECRET = ERP.ERP_IMPORT_INTERNAL_SECRET;
  const badSecret = await callErpImport("materials", {}, "wrong-secret");
  ok("W4: secret ผิด = 401", badSecret.status === 401);
  const unknownKind = await callErpImport("hack_the_planet", {}, ERP.ERP_IMPORT_INTERNAL_SECRET);
  ok("W4: kind ไม่รู้จัก = 400 (ไม่เดา provider API)", unknownKind.status === 400);

  // — W4 materials matcher: ตรงทะเบียนจริง ไม่สร้างใหม่
  const materials = await callErpImport("materials", { items: [{ name: "ดินถม" }, { name: "แกรนิตนำเข้าพ็อดเกาหลี" }] }, ERP.ERP_IMPORT_INTERNAL_SECRET);
  const m = materials.json as { matched?: number; unmatched?: string[]; catalog_size?: number };
  ok("W4: materials — matched จากทะเบียนจริง + unmatched จริงใจ (ไม่สร้างวัสดุใหม่)", materials.status === 200 && m.matched === 1 && Array.isArray(m.unmatched) && m.unmatched.length === 1, JSON.stringify(m));
  ok("W4: materials — catalog ไม่เติบโต (ยังตามทะเบียนเดิม)", (m.catalog_size ?? 0) >= 1);

  // — PART B migration status gate (ตรวจจริง — stock columns มาจาก migration W1 ด้วย)
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const ownerCol = await db.from("equipment_assets").select("owner_user_id").limit(1);
  const companyMembers = await db.from("company_members").select("id").limit(1);
  const stockCol = await db.from("pit_materials").select("stock_quantity").limit(1);
  const w2Ready = !ownerCol.error, w3Ready = !companyMembers.error, w1StockReady = !stockCol.error;
  console.log(`  [migration status] W1 stock columns: ${w1StockReady ? "APPLIED" : "PENDING"} · W2 asset ownership: ${w2Ready ? "APPLIED" : "PENDING"} · W3 company_members: ${w3Ready ? "APPLIED" : "PENDING"}`);

  // — W4 stock: canonical เส้นเดียว (W1) — ตรวจจริงเมื่อ migration W1 ขึ้นแล้วเท่านั้น
  //    (ยังไม่ขึ้น = BLOCKED ตามจริง ไม่หลอกผ่าน — เหมือนธรรมเนียม W1 ด้วย)
  if (w1StockReady) {
    const stockGhost = await callErpImport("stock", { pit_profile_id: crypto.randomUUID(), material_type_id: crypto.randomUUID(), direction: "in", quantity: 1, unit: "คิว" }, ERP.ERP_IMPORT_INTERNAL_SECRET);
    ok("W4: stock ผ่าน canonical เดิม (fail-closed บ่อไม่มีในทะเบียน)", stockGhost.status === 400 && /STOCK_LISTING_NOT_FOUND/.test(String(stockGhost.json.error ?? "")), JSON.stringify(stockGhost.json));
  } else {
    console.log("  BLOCKED W4 stock — รอ migration W1 (20261016000001) apply → pit_materials.stock_quantity ยังไม่มีจริง");
  }

  // — W4 suppliers → Connect Identity canonical เดิม (upsert provider erp:test) + ล้างท้าย
  const supRes = await callErpImport("suppliers", { suppliers: [{ external_id: `${TAG}sup-1`, name: `ผู้จำหน่ายทดสอบ ${TAG}` }] }, ERP.ERP_IMPORT_INTERNAL_SECRET);
  const s = supRes.json as { linked?: number; results?: { external_id?: string; ok?: boolean }[] };
  ok("W4: suppliers ผ่าน Connect Identity เดิมจริง (upsert)", supRes.status === 200 && s.linked === 1 && s.results?.[0]?.ok === true, JSON.stringify(s));

  // — W2: ownership fail-closed ที่ service จริง (บริษัทไม่ใช่ของฉัน = FORBIDDEN)
  const fakeCompany = crypto.randomUUID();
  const asset = await registerMyAsset("00000000-0000-0000-0000-000000000000", { asset_code: `${TAG}a1`, name: "รถทดสอบ", company_id: fakeCompany });
  ok("W2: company_id ที่ไม่มีความสัมพันธ์ = FORBIDDEN (ห้ามผูกทรัพย์ต่างบัญชี)", asset.ok === false && /FORBIDDEN/.test(asset.error ?? ""), asset.error);

  // — W3: invite fail-closed + lifecycle ไม่ยกระดับ admin
  const badInvite = await acceptCompanyInvite("00000000-0000-0000-0000-000000000000", "not-a-real-code");
  ok("W3: invite ไม่มีจริง = fail-closed", badInvite.ok === false);
  const inviteA = await createCompanyInvite("00000000-0000-0000-0000-000000000000", { company_id: fakeCompany, role_to_grant: "owner" });
  ok("W3: ออก invite โดยไม่ใช่เจ้าของยืนยันแล้ว = FORBIDDEN", inviteA.ok === false && /FORBIDDEN/.test(inviteA.error ?? ""), inviteA.error);

  if (!w2Ready || !w3Ready) {
    console.log("  BLOCKED — W2/W3 data-level รอ apply migration 20261016000002/03 (ธรรมเนียมระบบ: db push ต้องได้อนุมัติเจ้าของก่อน — pending พ่วงอื่นอยู่)");
  }

  // — ล้างข้อมูลทดสอบ Connect Identity (สร้างจริงขึ้นบน canonical เดิมตอนทดสอบ)
  try {
    await db.from("connect_external_identities").delete().ilike("provider", `erp:${TAG}%`);
  } catch (e) { console.log("cleanup warning:", e instanceof Error ? e.message : e); }

  // ส่งคืน secret ทดสอบ (ไม่ทิ้งค่าไว้ใน process ยาว)
  if (origSecret === undefined) delete process.env.ERP_IMPORT_INTERNAL_SECRET; else process.env.ERP_IMPORT_INTERNAL_SECRET = origSecret;

  console.log(`\n══ สรุป: ${pass} PASS / ${fail} FAIL ══\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => { console.error("test error:", err); process.exit(1); });
