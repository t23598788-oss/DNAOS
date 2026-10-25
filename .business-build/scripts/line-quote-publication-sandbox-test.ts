/**
 * LINE QUOTE — PUBLICATION SANDBOX TEST (STEP 4, owner mission 2026-10-19)
 *
 * Runs the REAL LINE pricing engine (supabase/functions/line-webhook-v2/engines/
 * quote-price.ts) against an in-memory fake Supabase client, so the external
 * customer path is exercised end-to-end (material → GPS → nearest pit → price →
 * vehicle/fuel → Flex card) WITHOUT deploying the function, without touching any
 * database, and without sending a LINE message.
 *
 * What it proves:
 *   S1 closed pit (is_open=false) can never be quoted, even when it is the
 *      nearest one with a real price — an open, farther pit wins instead
 *   S2 soft-deleted pit is excluded
 *   S3 pit material with no/zero price is never matched
 *   S4 no published supply → honest "no price" answer (ok=false, no card)
 *   S5 delivered price math is deterministic and the Flex card carries the same
 *      total as the text
 *   S6 supplier identity is masked (no pit name / owner / tax / bank fields)
 *   S7 the Flex quote carries the real business_events id (postback target)
 *
 * Run: npx tsx scripts/line-quote-publication-sandbox-test.ts
 */
import { tryQuoteMaterialPrice } from "../supabase/functions/line-webhook-v2/engines/quote-price";

type Row = Record<string, unknown>;
type Filters = { eq: [string, unknown][]; neq: [string, unknown][]; is: [string, unknown][]; gt: [string, number][]; not_null: string[] };

/**
 * Tiny PostgREST look-alike: only the chain shapes quote-price.ts actually
 * uses. Filters are applied to fixture rows; ordering and limit are honored.
 */
function makeClient(tables: Record<string, Row[]>) {
  const builder = (table: string) => {
    const f: Filters = { eq: [], neq: [], is: [], gt: [], not_null: [] };
    let orderBy: { column: string; ascending: boolean } | null = null;
    let max: number | null = null;

    const rows = () => {
      let out = [...(tables[table] ?? [])];
      for (const [c, v] of f.eq) out = out.filter((r) => r[c] === v);
      for (const [c, v] of f.neq) out = out.filter((r) => r[c] !== v);
      for (const [c, v] of f.is) out = out.filter((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v));
      for (const [c, v] of f.gt) out = out.filter((r) => Number(r[c]) > v);
      for (const c of f.not_null) out = out.filter((r) => r[c] !== null && r[c] !== undefined);
      if (orderBy) {
        const { column, ascending } = orderBy;
        out.sort((a, b) => {
          const av = a[column] as string | number;
          const bv = b[column] as string | number;
          return (av < bv ? -1 : av > bv ? 1 : 0) * (ascending ? 1 : -1);
        });
      }
      if (max !== null) out = out.slice(0, max);
      return out;
    };

    const api = {
      select: () => api,
      eq: (c: string, v: unknown) => { f.eq.push([c, v]); return api; },
      neq: (c: string, v: unknown) => { f.neq.push([c, v]); return api; },
      is: (c: string, v: unknown) => { f.is.push([c, v]); return api; },
      gt: (c: string, v: number) => { f.gt.push([c, v]); return api; },
      not: (c: string, op: string, v: unknown) => { if (op === "is" && v === null) f.not_null.push(c); return api; },
      order: (c: string, opts?: { ascending?: boolean }) => { orderBy = { column: c, ascending: opts?.ascending !== false }; return api; },
      limit: (n: number) => { max = n; return api; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: "no row" } }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows(), error: null }),
    };
    return api;
  };
  return { from: (table: string) => builder(table) };
}

let pass = 0;
let fail = 0;
function ck(id: string, ok: boolean, label: string, detail = "") {
  if (ok) { pass++; console.log(`PASS [${id}] ${label}`); }
  else { fail++; console.log(`FAIL [${id}] ${label}${detail ? ` — ${detail}` : ""}`); }
}

const USER = "U-sandbox-customer";

/** Two pits around the same site: the closed one is nearer AND priced. */
function fixtures(): Record<string, Row[]> {
  return {
    material_types: [{ id: "mat-sand", name: "ทรายหยาบ หรือ ทรายถม", density_ton_per_cbm: 1.6 }],
    line_events: [{ line_user_id: USER, raw_type: "location", extracted: { latitude: 13.75, longitude: 100.5 }, created_at: "2026-10-19T00:00:00Z" }],
    company_line_links: [],
    customer_sites: [],
    pit_profiles: [
      { id: "pit-closed-near", pit_name: "บ่อปิดลับ", latitude: "13.7505", longitude: "100.5005", is_open: false, deleted_at: null },
      { id: "pit-open-far", pit_name: "บ่อเปิดไกล", latitude: "13.93", longitude: "100.5", is_open: true, deleted_at: null },
      { id: "pit-deleted", pit_name: "บ่อถูกลบ", latitude: "13.7502", longitude: "100.5002", is_open: true, deleted_at: "2026-10-01T00:00:00Z" },
      { id: "pit-unpriced", pit_name: "บ่อไม่มีราคา", latitude: "13.7503", longitude: "100.5003", is_open: true, deleted_at: null },
    ],
    pit_materials: [
      { pit_profile_id: "pit-closed-near", material_type_id: "mat-sand", price: 100, deleted_at: null },
      { pit_profile_id: "pit-open-far", material_type_id: "mat-sand", price: 380, deleted_at: null },
      { pit_profile_id: "pit-deleted", material_type_id: "mat-sand", price: 50, deleted_at: null },
      { pit_profile_id: "pit-unpriced", material_type_id: "mat-sand", price: 0, deleted_at: null },
    ],
    vehicle_types: [{ name: "รถ 10 ล้อ (ดั้ม)", load_capacity: 10, fuel_consumption_rate: 4, deleted_at: null }],
    fuel_price_log: [{ price: 32, fetched_at: "2026-10-19T00:00:00Z" }],
  };
}

async function main() {
  console.log("\n══ LINE QUOTE PUBLICATION SANDBOX (no deploy, no DB, no message) ══\n");

  // ── S1/S2/S3: nearest closed pit must lose to the published one ──
  const quoted = await tryQuoteMaterialPrice(makeClient(fixtures()), USER, "ทรายหยาบ", 10, null, "ตัน", "evt-123");
  ck("S1.1", quoted.ok === true, "published supply produces a quote", quoted.text);
  ck("S1.2", quoted.text.includes("20.0 กม."), "chosen pit is the OPEN one (20 km), not the closed/farther-or-nearer traps", quoted.text.split("\n")[0]);
  ck("S1.3", !quoted.text.includes("บ่อปิดลับ") && !quoted.text.includes("บ่อถูกลบ") && !quoted.text.includes("บ่อไม่มีราคา"), "no rejected pit identity leaks into the answer");
  ck("S1.4", !quoted.text.includes("100 บาท/ตัน"), "closed pit's cheaper ฿100 price is never quoted (the exact leak: closed pit wins on price)");
  // The engine's own rule: pit_materials.price is the COST/gate price and is
  // never shown to a customer — only the marked-up sell price is.
  ck("S1.5", quoted.text.includes("475 บาท/ตัน") && !quoted.text.includes("380"), "published ฿380 cost → ฿475 sell price; cost price stays hidden", quoted.text.split("\n")[1]);
  ck("S1.6", quoted.text.includes("บ่อวัสดุในระบบ"), "supplier identity is masked to the generic label");
  ck("S2.1", !quoted.text.includes("บ่อถูกลบ"), "soft-deleted pit never quoted");
  ck("S3.1", !quoted.text.includes("บ่อไม่มีราคา"), "pit with price 0 never matched");

  // ── S5: deterministic delivered price, card agrees with text ──
  // distance 20 km → round trip 40 km / 4 km-per-l = 10 l × 32 × 1.25 = ฿400/trip
  // 10 t / 10 t-per-trip = 1 trip → transport ฿400 ; material 475 × 10 = ฿4,750
  ck("S5.1", quoted.text.includes("4,750") && quoted.text.includes("400") && quoted.text.includes("5,150"), "material ฿4,750 + transport ฿400 = ฿5,150", quoted.text);
  const flex = (quoted as { flex?: Record<string, unknown> }).flex as
    | { body?: { contents?: { contents?: { text?: string }[] }[] } }
    | undefined;
  const flexJson = JSON.stringify(flex ?? {});
  ck("S5.2", /5,?150/.test(flexJson), "Flex card carries the same total as the text", flexJson.slice(0, 200));
  ck("S5.3", flexJson.includes("475") && flexJson.includes("400"), "Flex card shows real unit price and transport line");

  // ── S6: no private supplier identifiers anywhere in the answer ──
  const whole = `${quoted.text}${flexJson}`;
  ck("S6.1", !/pit-open-far|pit-closed-near|owner_user_id|tax_id|bank_account/.test(whole), "no private ids/fields in the customer answer");
  ck("S6.2", !whole.includes("บ่อเปิดไกล"), "even the winning pit's real name stays private");

  // ── S7: real business_events id travels into the card ──
  ck("S7.1", flexJson.includes("evt-123"), "Flex quote id is the real business_events id (postback acts on a real row)");

  // ── S4: unpublished-only world → honest no-price answer, no card ──
  const onlyClosed = fixtures();
  onlyClosed.pit_profiles = onlyClosed.pit_profiles.filter((p) => p.id === "pit-closed-near");
  const none = await tryQuoteMaterialPrice(makeClient(onlyClosed), USER, "ทรายหยาบ", 10, null, "ตัน", "evt-404");
  ck("S4.1", none.ok === false, "only closed supply → ok=false (no quote is created)", none.text);
  ck("S4.2", none.text.includes("ยังไม่มีบ่อไหนในระบบตั้งราคา"), "answer states the real fact instead of a holding promise", none.text);
  ck("S4.3", (none as { flex?: unknown }).flex === undefined, "no Flex card is produced without published supply");

  // ── sanity: the sandbox itself is not vacuous ──
  const allOpen = fixtures();
  onlyClosed.pit_profiles = fixtures().pit_profiles; // restore for isolation
  allOpen.pit_profiles = allOpen.pit_profiles.map((p) => ({ ...p, is_open: true }));
  const all = await tryQuoteMaterialPrice(makeClient(allOpen), USER, "ทรายหยาบ", 10, null, "ตัน", "evt-999");
  ck("S8.1", all.ok === true && all.text.includes("0.1 กม."), "control: when every pit is open the nearest (0.1 km) pit is quoted", all.text.split("\n")[0]);

  console.log(`\n═══ LINE QUOTE SANDBOX: ${pass} PASS / ${fail} FAIL ═══`);
  console.log("real engine, stub client — no deployment, no database, no LINE message sent");
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(2);
});
