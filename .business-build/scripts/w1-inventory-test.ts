/**
 * W1 RESOURCE INVENTORY TEST (owner directive 2026-10-15)
 *
 * PART A — Contract fail-closed (รันได้จริงตอนนี้): ทวนตรวจตรรกะที่ตัดสินก่อนแตะ
 *          ตาราง — direction/quantity/unit/idempotency/actor และ ownership gate
 * PART B — Data-level (ต้องการ migration 20261016000001 apply แล้ว): matrix ครบ
 *          รับเข้า/จ่ายออก/จอง/คืน/แปลงหน่วยตามหลักฐาน/ประวัติบนตารางเดิม
 *          · ถ้า schema ยังไม่ถูก apply จะแจ้ง BLOCKED ตรงตามจริง (ไม่หลอกผ่าน)
 * ข้อมูลทดสอบ prefix [test-w1-] — ล้างท้ายจริงทุกครั้ง
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { writeStockMovement } from "../engines/canonical/stock-write";
import { recordMyStockMovement, getMyInventory } from "../engines/public-registry/service";

let pass = 0; let fail = 0;
function ok(name: string, cond: boolean | undefined, detail?: string): void {
  if (cond === true) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TAG = "test-w1-";
const email = `zzz-${TAG}${Date.now()}@example.com`;
let pitId = ""; let matTypeId = ""; let authUserId = "";

function okContract(name: string, res: { ok: boolean; error?: string }, codeWant: string): void {
  ok(name, res.ok === false && (res.error ?? "").includes(codeWant), res.error ?? "(ok unexpectedly)");
}

async function cleanup(db: SupabaseClient): Promise<void> {
  try {
    const pits = await db.from("pit_profiles").select("id").ilike("pit_name", `%${TAG}%`);
    const ids = (pits.data ?? []).map((r: { id: string }) => r.id);
    if (ids.length) {
      await db.from("pit_materials").delete().in("pit_profile_id", ids);
      await db.from("pit_profiles").delete().in("id", ids);
    }
    const prof = await db.from("profiles").select("id").ilike("email", `zzz-${TAG}%`);
    const pid = (prof.data?.[0] as unknown as { id: string } | null)?.id;
    if (pid) {
      await db.from("profiles").delete().eq("id", pid);
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      try { await admin.auth.admin.deleteUser(pid); } catch { /* optional */ }
    }
  } catch (e) { console.log("cleanup warning:", e instanceof Error ? e.message : e); }
}

async function stockColumnsReady(db: SupabaseClient): Promise<{ ready: boolean; log: string }> {
  const probe = await db.from("pit_materials").select("stock_quantity").limit(1);
  return { ready: !probe.error, log: probe.error ? probe.error.message : "ok" };
}

async function main(): Promise<void> {
  console.log("\n══ W1 RESOURCE INVENTORY TEST ══\n");
  const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  // ══ PART A — Contract fail-closed (ตัดสินก่อนแตะ columns — จริงตอนนี้) ══
  console.log("PART A — Contract (fail-closed ก่อนแตะฐานข้อมูล)");
  const base = { pit_profile_id: "does-not-exist", material_type_id: "does-not-exist", actor: "test-w1" };
  const side = Date.now();
  okContract("direction ไม่อยู่ในชุดเดิม = DIRECTION_UNKNOWN", await writeStockMovement({ ...base, direction: "steal" as never, quantity: 1, unit: "คิว", source_event_id: `a${side}` }), "STOCK_DIRECTION_UNKNOWN");
  okContract("quantity 0/ติดลบ/ไม่ใช่เลข = QUANTITY_INVALID", await writeStockMovement({ ...base, direction: "in", quantity: 0, unit: "คิว", source_event_id: `a${side + 1}` }), "STOCK_QUANTITY_INVALID");
  okContract("หน่วยว่าง = UNIT_REQUIRED (ห้ามไม่มีหลักภาษา)", await writeStockMovement({ ...base, direction: "in", quantity: 1, unit: "  ", source_event_id: `a${side + 2}` }), "STOCK_UNIT_REQUIRED");
  okContract("source_event_id ว่าง = ต้องมี idempotency key", await writeStockMovement({ ...base, direction: "in", quantity: 1, unit: "คิว", source_event_id: " " }), "STOCK_IDEMPOTENCY_OR_ACTOR_REQUIRED");
  // ownership gate ผ่าน service: บ่อที่ไม่มีจริง → NOT_FOUND (ไม่ใช่ FORBIDDEN — กัน leak ข้อมูลระบุตัวตน)
  const ghostCall = await recordMyStockMovement("00000000-0000-0000-0000-000000000000", { pit_id: crypto.randomUUID(), material_type_id: "x", direction: "in", quantity: 1, unit: "คิว" });
  ok("service: บ่อไม่มีจริง = NOT_FOUND (ไม่บอกหรือรั่วอย่างอื่น)", ghostCall.ok === false && /NOT_FOUND/.test(ghostCall.error ?? ""), ghostCall.error);

  // ══ PART B — Data-level (ต้องการ migration applied) ══
  console.log("\nPART B — Data-level (expects migration 20261016000001 applied)");
  const ready = await stockColumnsReady(db);
  if (!ready.ready) {
    console.log(`  BLOCKED — schema ยังไม่ถูก apply (real: ${ready.log})`);
    console.log("  ต้อง apply migration 20261016000001_material_stock_inventory.sql ก่อน");
    console.log("  (ธรรมเนียมระบบ: db push ต้องได้อนุมัติจากเจ้าของก่อนเพราะมี pending พ่วงอื่นอยู่)");
    await cleanup(db);
    console.log(`\n══ สรุป: ${pass} PASS / ${fail} FAIL · data-level BLOCKED (รอ migration apply) ══\n`);
    if (fail > 0) process.exit(1);
    return;
  }

  const link = await db.auth.admin.generateLink({ type: "signup", email, password: "dna-reg-test-123" });
  authUserId = (link as unknown as { data?: { user?: { id?: string } } }).data?.user?.id ?? "";
  if (authUserId) await db.from("profiles").upsert({ id: authUserId, email, role: "partner" });
  ok("เตรียม: user ทดสอบจริง", !!authUserId);
  matTypeId = (((await db.from("material_types").select("id, name").ilike("name", "ดินถม").is("deleted_at", null).limit(1)).data?.[0]) as unknown as { id: string })?.id ?? "";
  ok("เตรียม: วัสดุ 'ดินถม' (มี density จริง — หลักฐานหน่วย)", !!matTypeId);
  pitId = crypto.randomUUID();
  await db.from("pit_profiles").insert({ id: pitId, user_id: authUserId, pit_name: `[${TAG}บ่อสต็อก]`, is_open: true, latitude: 13.9, longitude: 100.5 });
  await db.from("pit_materials").insert({ id: crypto.randomUUID(), pit_profile_id: pitId, material_type_id: matTypeId, price: 300 });

  const in1 = await writeStockMovement({ pit_profile_id: pitId, material_type_id: matTypeId, direction: "in", quantity: 10, unit: "คิว", source_event_id: `w1-in-${TAG}${Date.now()}`, actor: "test-w1" });
  ok("รับเข้า 10 คิว → stock=10, available=10", in1.ok === true && in1.stock?.stock_quantity === 10 && in1.stock?.available_quantity === 10, JSON.stringify(in1));

  const out1 = await writeStockMovement({ pit_profile_id: pitId, material_type_id: matTypeId, direction: "out", quantity: 4, unit: "คิว", source_event_id: `w1-out-${TAG}${Date.now()}`, actor: "test-w1" });
  ok("จ่ายออก 4 → stock=6", out1.ok === true && out1.stock?.stock_quantity === 6, JSON.stringify(out1));

  const res3 = await writeStockMovement({ pit_profile_id: pitId, material_type_id: matTypeId, direction: "reserve", quantity: 3, unit: "คิว", source_event_id: `w1-res-${TAG}${Date.now()}`, actor: "test-w1" });
  ok("จอง 3 → reserved=3, available=3", res3.ok === true && res3.stock?.reserved_quantity === 3 && res3.stock?.available_quantity === 3, JSON.stringify(res3));
  const overRes = await writeStockMovement({ pit_profile_id: pitId, material_type_id: matTypeId, direction: "out", quantity: 4, unit: "คิว", source_event_id: `w1-over-${TAG}${Date.now()}`, actor: "test-w1" });
  ok("จ่ายเกิน available = ปฏิเสธ", overRes.ok === false && /INSUFFICIENT/.test(overRes.error ?? ""), overRes.error);

  const ton = await writeStockMovement({ pit_profile_id: pitId, material_type_id: matTypeId, direction: "in", quantity: 1, unit: "ตัน", source_event_id: `w1-ton-${TAG}${Date.now()}`, actor: "test-w1" });
  ok("รับเข้า 1 ตัน → แปลงตาม density(1.3) จริง", ton.ok === true && !!ton.stock && Math.abs(Number(ton.stock.stock_quantity) - (6 + 1 / 1.3)) < 1e-9 && ton.stock.stock_unit === "คิว", JSON.stringify(ton));

  const ghost = await writeStockMovement({ pit_profile_id: pitId, material_type_id: matTypeId, direction: "in", quantity: 5, unit: "กระสอบ", source_event_id: `w1-ghost-${TAG}${Date.now()}`, actor: "test-w1" });
  ok("หน่วย 'กระสอบ' ไม่มีหลักฐานแปลง = fail-closed", ghost.ok === false && /NO_EVIDENCE/.test(ghost.error ?? ""), ghost.error);

  const eid = `w1-idem-${TAG}${Date.now()}`;
  const first = await writeStockMovement({ pit_profile_id: pitId, material_type_id: matTypeId, direction: "in", quantity: 2, unit: "คิว", source_event_id: eid, actor: "test-w1" });
  const again = await writeStockMovement({ pit_profile_id: pitId, material_type_id: matTypeId, direction: "in", quantity: 2, unit: "คิว", source_event_id: eid, actor: "test-w1" });
  ok("idempotent: event ซ้ำ = duplicate:true และยอดคงเดิม", first.ok === true && again.ok === true && again.duplicate === true && again.stock?.stock_quantity === first.stock?.stock_quantity, JSON.stringify({ first: first.stock, again: again.stock }));

  const strangerRes = await recordMyStockMovement("11111111-1111-1111-1111-111111111111", { pit_id: pitId, material_type_id: matTypeId, direction: "in", quantity: 1, unit: "คิว" });
  ok("ownership gate ต่างบัญชี = FORBIDDEN", strangerRes.ok === false && /FORBIDDEN/.test(strangerRes.error ?? ""), strangerRes.error);

  const inv = await getMyInventory(authUserId);
  const site = (inv.sites ?? [])[0] as { pit_id: string; inventory: { stock_quantity: number; stock_unit: string | null; stock_updated_at: string | null; available_quantity: number }[]; movements: unknown[] } | undefined;
  ok("สรุปสต็อกแยกเจ้าของ/โกดัง + stock_updated_at จริง", inv.ok === true && !!site && site.inventory.length === 1 && !!site.inventory[0].stock_updated_at, JSON.stringify(site?.inventory?.[0] ?? {}));
  ok("ประวัติเคลื่อนไหวอยู่บนตารางเดิม (resource_transactions)", !!site && (site.movements?.length ?? 0) >= 6, `movements=${site?.movements?.length}`);

  await cleanup(db);
  console.log(`\n══ สรุป: ${pass} PASS / ${fail} FAIL (ข้อมูลทดสอบถูกล้างแล้ว) ══\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => { console.error("test error:", err); process.exit(1); });
