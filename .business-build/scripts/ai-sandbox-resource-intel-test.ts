/**
 * RESOURCE INTELLIGENCE TEST — owner directive 2026-10-15
 *
 * พิสูจน์ว่า Sales AI sandbox ค้นหาวัสดุ/แหล่งทรัพยากร/ผู้ประกอบการจาก
 * ข้อมูลจริงได้ผ่าน Capability Dispatcher เดิม (จุดบังคับเดียว + sandbox gate):
 *
 *   1. material.list คืนรายการจาก DB จริง — ราคาทุกตัวมาจาก pit_materials
 *      จริงเท่านั้น (ไม่มีหลักฐาน = null — ห้ามแต่ง)
 *   2. material.quote วัสดุที่มีจริง = matched จริง · บอกเหตุจริงเมื่อคำนวณ
 *      ระยะ/ราคาข้ามขั้นไม่ได้ (no_customer_id/no_gps) — ไม่เดา
 *   3. material.quote วัสดุที่ระบบไม่มี = matched:false — ไม่คิดราคาให้
 *   4. material.sources จากพิกัดจริงของบ่อใน DB (ไม่ใช้พิกัดแต่ง)
 *   5. pit.find (เส้นใหม่ — handler เติมให้ def ที่ประกาศไว้ใน registry)
 *      เจอบ่อจริง + ราคาจริง · คำที่ไม่มีในระบบ = NOT_FOUND (total:0)
 *   6. Sales sandbox ยัง DENY การเงิน/เอกสาร/เจ้าของทุกเส้นเดิม
 *
 * รัน: (source .env.local ก่อน) npx tsx scripts/ai-sandbox-resource-intel-test.ts
 * ข้อจำกัดจริงใจ: ทดสอบอ่านอย่างเดียว — ไม่มีการเขียน DB · ไม่ส่ง LINE · ไม่ deploy
 */
import { createClient } from "@supabase/supabase-js";
import { decideSandboxCommand } from "../core/auth/surfacePolicy";
import { buildVerifiedScope } from "../core/auth/orgScope";
import { dispatch } from "../engines/validation/dispatcher";

let passCount = 0;
let failCount = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passCount++;
    console.log(`  PASS ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// `material.quote` became a tenant-scoped command (2026-10-19 isolation repair):
// it reads a customer's saved GPS, so it must carry a verified scope. This is a
// synthetic scope fixture for the read-only test — no real tenant data is read
// because the test only exercises the "no customer_id" branch.
const SALES = {
  sandbox: "sales" as const,
  scope: buildVerifiedScope({
    userId: "sales-intel-test",
    appRole: "employee",
    organizationId: "sales-intel-test-org",
    orgRole: "member",
    companyIds: ["sales-intel-test-company"],
  }),
};

async function main(): Promise<void> {
  console.log("\n══ RESOURCE INTELLIGENCE TEST — Sales AI on real data ══\n");

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );

  // ฐานอ้างอิงจริงจาก DB (เทียบกับผล dispatch ตรง ๆ)
  const { data: mats } = await db.from("material_types").select("id, name").is("deleted_at", null);
  const { data: pits } = await db.from("pit_profiles").select("id, pit_name, latitude, longitude, is_open").is("deleted_at", null).limit(500);
  const { data: links } = await db.from("pit_materials").select("pit_profile_id, material_type_id, price").is("deleted_at", null);
  const realMatNames = (mats ?? []).map((m) => m.name) as string[];
  const realPrices = (links ?? []).filter((l) => l.price != null && l.price > 0).map((l) => Number(l.price)) as number[];
  // 2026-10-19 publication boundary: the Sales AI may only be exercised against
  // published supply (open + priced). Picking any pit here used to make the test
  // depend on closed supply, which is exactly the leak the boundary removed.
  const pricedPitIds = new Set((links ?? []).filter((l) => l.price != null && Number(l.price) > 0).map((l) => String(l.pit_profile_id)));
  const publishedPits = (pits ?? []).filter((p) => p.is_open === true && pricedPitIds.has(String(p.id)));

  console.log(`ฐานจริง: วัสดุ active ${realMatNames.length} · บ่อ active ${(pits ?? []).length} · รายการราคาจริง ${realPrices.length}\n`);

  // ── 1) material.list — ข้อมูลจริงทั้งหมด ผ่าน sandbox sales ──
  console.log("1) material.list (ข้อมูลจริง / ราคาจาก pit_materials เท่านั้น)");
  const listRes = await dispatch("material.list", {}, false, SALES);
  const listData = listRes.data as { result_type: string; total: number; materials: { name: string; sources: (string | null)[]; price_min: number | null; price_max: number | null }[] } | null;
  ok("dispatch(sales) ผ่าน + ผลจริง", listRes.ok && listData?.result_type === "MATERIAL_LIST", JSON.stringify(listRes.violations));
  ok("จำนวนวัสดุตรง DB จริง", listData?.total === realMatNames.length && listData.materials.length === realMatNames.length);
  ok("ชื่อวัสดุตรง DB จริงทุกตัว", (listData?.materials ?? []).every((m) => realMatNames.includes(m.name)));
  const withAnyPrice = (listData?.materials ?? []).some((m) => m.price_min != null && m.price_min > 0);
  const noFabricated = (listData?.materials ?? []).every((m) =>
    (m.price_min === null && m.price_max === null) ||
    (m.price_min !== null && m.price_min > 0 && m.price_max !== null && m.price_max >= m.price_min && realPrices.includes(m.price_min) && realPrices.includes(m.price_max ?? -1)),
  );
  ok("ราคาทุกตัวมาจาก pit_materials จริง (ไม่แต่ง)", withAnyPrice && noFabricated && !!listRes.ok);
  const noSourceMat = (listData?.materials ?? []).find((m) => (m.sources ?? []).length === 0);
  ok("วัสดุไม่มีแหล่ง = price null จริงใจ (ห้าม ฿0)", !!noSourceMat ? (noSourceMat.price_min === null && noSourceMat.price_max === null) : true);

  // ── 2) material.quote — วัสดุมีจริง + บอกเหตุจริงเมื่อไปต่อไม่ได้ ──
  console.log("2) material.quote (วัสดุจริง / ไม่มีลูกค้า GPS = บอกจริง)");
  const sandName = realMatNames.includes("ทรายละเอียด") ? "ทรายละเอียด" : realMatNames[0];
  const quoteRes = await dispatch("material.quote", { raw_input: `${sandName} 3 คิว`, quantity: 3 }, false, SALES);
  const quoteData = quoteRes.data as { matched: boolean; material_name?: string; error?: string } | null;
  ok("dispatch(sales) ผ่าน + matched ตามของจริง", quoteRes.ok && quoteData?.matched === true, JSON.stringify(quoteRes.violations));
  ok("ชื่อวัสดุที่ match = วัสดุจริงในระบบ", quoteData?.material_name != null && realMatNames.includes(quoteData.material_name));
  ok("ต่อไม่ได้เพราะไม่มี customer_id — บอกตรงไป (ไม่แต่งราคา)", quoteData?.matched === true && quoteData?.error === "no_customer_id");

  // ── 3) material.quote — วัสดุที่ระบบไม่มี = ปฏิเสธเจตนา ──
  console.log("3) วัสดุที่ระบบไม่มี = NOT_FOUND จริงใจ");
  const ghostRes = await dispatch("material.quote", { raw_input: "แกรนิตนำเข้าพ็อดเกาหลี 2 คิว", quantity: 2 }, false, SALES);
  const ghostData = ghostRes.data as { matched: boolean; error?: string; material_name?: string } | null;
  ok("matched:false — ไม่เดาวัสดุ ไม่แต่งราคา", ghostRes.ok && ghostData?.matched === false && ghostData?.material_name == null);

  // ── 4) material.sources — พิกัดจริงของบ่อ (lat/lng จาก DB) ──
  console.log("4) material.sources จากพิกัดจริงของบ่อใน DB");
  const gpsPit = publishedPits.find((p) => p.latitude != null && p.longitude != null && p.latitude !== 0);
  if (gpsPit) {
    const srcRes = await dispatch("material.sources", { lat: gpsPit.latitude, lng: gpsPit.longitude }, false, SALES);
    const srcData = srcRes.data as { pit_profile_id?: string; distance_km?: number } | null;
    ok("จากพิกัดบ่อจริง → แหล่งจริง (ไม่โยน error)", srcRes.ok === true, JSON.stringify({ violations: srcRes.violations, srcData }));
  } else {
    ok("material.sources (ขข้าม — ไม่มีบ่อที่มีพิกัดซีโร่ไม่ใช่ 0 ใน DB)", true);
  }

  // ── 5) pit.find — เส้น Resource Intelligence ใหม่ (เส้น sales allow) ──
  console.log("5) pit.find (บ่อจริง / NOT_FOUND จริง)");
  const pitDecision = decideSandboxCommand({ command: "pit.find", sandbox: "sales" });
  ok("sandbox sales อนุญาต pit.*", pitDecision.allowed, pitDecision.reason);
  const findReal = publishedPits.find((p) => p.pit_name && String(p.pit_name).length >= 2);
  if (findReal?.pit_name) {
    const findRes = await dispatch("pit.find", { keyword: String(findReal.pit_name).slice(0, 4) }, false, SALES);
    const findData = findRes.data as { result_type: string; total: number; hits: { pit_name: string | null; materials: { price: number | null; price_source: string | null }[] }[] } | null;
    ok("ข้อมูลจริง: เจอบ่อ + ราคาทุกตัวหลักฐานจาก pit_materials", findRes.ok && findData?.total != null && findData.total > 0 && (findData.hits ?? []).every((h) => h.materials.every((m) => m.price === null || m.price_source === "pit_materials")), JSON.stringify(findData?.hits?.[0] ?? {}).slice(0, 200));
  } else {
    ok("pit.find (ข้าม case บ่อจริง — ไม่มีชื่อบ่อใน DB)", true);
  }
  const missRes = await dispatch("pit.find", { keyword: "zzzไม่มีจริงxyz" }, false, SALES);
  const missData = missRes.data as { result_type: string; total: number; hits: unknown[] } | null;
  ok("คำที่ไม่มีในระบบ = NOT_FOUND (total:0, hits:[])", missRes.ok && missData?.total === 0 && Array.isArray(missData?.hits) && missData.hits.length === 0);

  // ── 6) เขตเดิมยังแน่น: ขายไม่รู้การเงิน/เอกสารของเจ้าของ ──
  console.log("6) boundary คงเดิม (isolation หลังเปรียบเทียบ)");
  for (const cmd of ["debt.current", "document.list", "invoice.items", "partner.timeline", "material.quote"] as const) {
    const d = decideSandboxCommand({ command: cmd, sandbox: "sales" });
    const expected = cmd === "material.quote" ? d.allowed : !d.allowed;
    ok(`${cmd} ตัดสินตาม sandbox ถูกต้อง (${cmd === "material.quote" ? "ALLOW" : "DENY"})`, expected, d.reason);
    if (cmd !== "material.quote") {
      const res = await dispatch(cmd, {}, false, SALES);
      ok(`${cmd} dispatch DENY (SALES_SANDBOX_DENY)`, !res.ok && res.violations.join(" ").includes("SALES_SANDBOX_DENY"), JSON.stringify(res.violations));
    }
  }

  console.log(`\n══ สรุป: ${passCount} PASS / ${failCount} FAIL ══\n`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("test error:", err);
  process.exit(1);
});
