/**
 * CONNECT BOUNDARY CENSUS (T1/T2/T4/T12 — LINE provider-retreat Phase-1 §9).
 *
 * วัดและล็อกเพดานการเขียน business table ของ PROVIDER tier ให้ลดได้อย่างเดียว
 * เพิ่มไม่ได้ — พร้อม invariant ที่ P3 ปิดไปแล้วต้องอยู่ตลอดกาล (business_events
 * ต้องเป็น 0 direct write) และเสาการเงินที่ต้องไม่เกิน baseline จนกว่า P4 จะ
 * ตัดสินเส้นเงิน (§11 D2/D3):
 *
 *   BUSINESS_EVENTS_WRITES  = 0    (P3 cutover — invariant ถาวร ห้ามกลับ)
 *   DENO_BUSINESS_SITES     ≤ 26   (12 ตาราง — ลดตาม P4/P6 ห้ามเพิ่ม)
 *   NEXT_BUSINESS_SITES     ≤ 3    (live_commands + receipt_documents)
 *   PROVIDER_MONETARY_SITES ≤ 2    (out-of-scope pair เท่านั้น · LINE scope = 0
 *                                   — D3 work landed 2026-09-24)
 *   RECONCILE_RPC_CALLERS   ≤ 1    (→ 0 หลัง D2)
 *   PAYMENT_AUTHORITIES     ≤ 2    (canonical ต้องมี 1 เสมอ · target 1 หลัง D2)
 *
 * ขอบเขต scan (§3.1/§3.2): supabase/functions/** + Next provider routes
 * (line-customers · line-profiles · outbound-drafts · receipt-documents ·
 * internal/line · internal/connect) — ไม่แตะ engines/canonical/business routes
 *
 * ทุกตัวเลขมาจาก source จริง ณ ตอนรัน (ไม่ใช้ report เป็นหลักฐานเดียว) ·
 * strip comment ก่อน match · NC1 พิสูจน์ scanner จับจริงไม่ใช่ empty matcher
 *
 * Run: npx tsx scripts/connect-boundary-census-test.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

// ── Baselines (วัดจาก source จริง 2026-09-24 · ตรง §12 ของ Phase-1 report) ─
// D2 = ก (owner, 2026-09-24): หลัง P4a rewire — reconcile_receipt_payment
// ถูกแทนที่ด้วย Connect payment-confirm bridge แล้ว ⇒ caller ต้อง = 0 และ
// payment authority เหลือ exactly 1 (canonical payment-write) — ค่าสองตัวนี้
// จึงเป็น invariant แล้ว ไม่ใช่เพดานอีกต่อไป
const BASELINE = {
  // P4b (2026-09-24): claim + OCR receipt inserts ย้ายเข้า inbound bridge →
  // receipt_documents direct write ใน Deno เหลือเฉพาะ sweep link update ⇒ 24
  DENO_BUSINESS_SITES: 24,
  DENO_BUSINESS_TABLES: 12,
  NEXT_BUSINESS_SITES: 3,
  // D3 deferred work LANDED (owner 2026-09-24): LINE-scope money-out writes all
  // route through the Connect expense bridge → engines/canonical/expense-write.
  // The remaining pair is Phase-1 §0 out-of-scope (bank-email-sync +
  // subscription-email-sync — separate provider list, not LINE phases).
  PROVIDER_MONETARY_SITES: 2,
  RECONCILE_RPC_CALLERS: 0,
  PAYMENT_AUTHORITIES: 1,
} as const;

/** ตาราง edge ของ provider เอง (§6 KEEP) — ไม่ใช่ business truth */
const EDGE_TABLES = new Set([
  "line_events", "line_profiles", "line_outbound_drafts",
  "line_customer_memory", "line_conversation_controls",
]);
/** ตาราง control/chore — ไม่ใช่ business truth */
const CHORE_TABLES = new Set([
  "ai_tasks", "app_configs", "system_health_status", "conversation_states",
  "entity_registry", "fuel_price_log", "subscription_services", "supabase_billing_events",
]);
/** DNA OS platform-cost attribution/evidence, not customer business records. */
const PLATFORM_ACCOUNTING_TABLES = new Set(["subscription_costs", "subscription_evidence"]);
/** ตารางเงินที่ provider ห้ามแตะหลัง P4 (§11 D2/D3 — ยังเปิดเป็น baseline) */
const MONETARY_TABLES = new Set(["company_expenses", "partner_payable_requests"]);

const DENO_DIRS = ["supabase/functions"];
const NEXT_PROVIDER_DIRS = [
  "app/api/admin/line-customers",
  "app/api/admin/line-profiles",
  "app/api/admin/outbound-drafts",
  "app/api/admin/receipt-documents",
  "app/api/internal/line",
  "app/api/internal/connect",
];

const FROM_WRITE_RE = /\.from\(\s*["']([a-z_]+)["']\s*\)\s*\.\s*(insert|update|delete|upsert)/g;
const RPC_RE = /\.rpc\(\s*["']([a-z_0-9]+)["']/g;

interface WriteSite { file: string; table: string; op: string }
interface ScanResult { writes: WriteSite[]; rpcs: { file: string; name: string }[] }

function walk(dir: string, out: string[] = []): string[] {
  try { statSync(dir); } catch { return out; }
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** ตัด block comment + line comment — กันนิยายใน comment กลายเป็น write site */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}


function main() {
  let pass = 0;
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail = "") => {
    if (ok) { pass++; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
    else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
  };

  console.log("=== CONNECT BOUNDARY CENSUS (T1/T2/T4/T12 · Phase-1 §9) ===\n");

  const deno = scanDirs(DENO_DIRS);
  const next = scanDirs(NEXT_PROVIDER_DIRS);

  const denoBusiness = deno.writes.filter(isBusiness);
  const nextBusiness = next.writes.filter(isBusiness);
  const denoMonetary = deno.writes.filter((w) => MONETARY_TABLES.has(w.table));
  const denoReconcile = deno.rpcs.filter((r) => r.name === "reconcile_receipt_payment");

  // ── invariant ถาวรหลัง P3 cutover (NC1 พิสูจน์ว่า scanner จับจริง) ─────
  const beWrites = [...deno.writes, ...next.writes].filter((w) => w.table === "business_events");
  check(
    "T1a BUSINESS_EVENTS direct writes in provider tier = 0 (P3 cutover stays)",
    beWrites.length === 0,
    `found ${beWrites.length}${beWrites.length ? `: ${beWrites.map((w) => w.file).join(", ")}` : ""}`,
  );

  // ── เพดานไม่ให้เพิ่ม (ลดได้เสมอเมื่อ P4/P6 เดินหน้า) ──────────────────
  const denoBusinessTables = new Set(denoBusiness.map((w) => w.table));
  check(
    "T1b DENO business write sites stay within baseline",
    denoBusiness.length <= BASELINE.DENO_BUSINESS_SITES && denoBusinessTables.size <= BASELINE.DENO_BUSINESS_TABLES,
    `${denoBusiness.length}/${BASELINE.DENO_BUSINESS_SITES} sites · ${denoBusinessTables.size}/${BASELINE.DENO_BUSINESS_TABLES} tables`,
  );
  check(
    "T1c NEXT provider-route business write sites stay within baseline",
    nextBusiness.length <= BASELINE.NEXT_BUSINESS_SITES,
    `${nextBusiness.length}/${BASELINE.NEXT_BUSINESS_SITES} sites`,
  );

  // ── เสาการเงิน: P4 (D2/D3) ยังไม่ตัดสิน — ล็อกไม่ให้เพิ่ม ลดเมื่อปิดเส้น ──
  // ── เสาการเงิน: D3 work LANDED (2026-09-24) — เข้มกว่าเพดานเดิม:
  //    1) total ≤ 2 (เฉพาะคู่ out-of-scope) และ
  //    2) LINE scope ต้องเป็น 0 เสมอ — เขียนตรงใน line-webhook-v2 = block ทันที
  const lineMonetary = denoMonetary.filter((w) => w.file.includes("line-webhook-v2/"));
  check(
    "T2a PROVIDER monetary sites = out-of-scope pair only · LINE scope = 0 (D3 LANDED)",
    denoMonetary.length <= BASELINE.PROVIDER_MONETARY_SITES && lineMonetary.length === 0,
    `${denoMonetary.length}/${BASELINE.PROVIDER_MONETARY_SITES} total · line-scope=${lineMonetary.length}${lineMonetary.length ? ` (${lineMonetary.map((w) => w.file).join(", ")})` : ""}`,
  );
  check(
    "T2b reconcile_receipt_payment callers in the provider tier = 0 (D2=ก implemented)",
    denoReconcile.length <= BASELINE.RECONCILE_RPC_CALLERS,
    `${denoReconcile.length}/${BASELINE.RECONCILE_RPC_CALLERS}`,
  );

  // ── T12 payment authority (B-04 regression): canonical writer ต้องเป็น authority เดียว ──
  const paymentWriteSrc = readFileSync(join(ROOT, "engines/canonical/payment-write.ts"), "utf8");
  const canonicalAlive = /confirm_payment_allocation/.test(stripComments(paymentWriteSrc));
  check(
    "T12 PAYMENT_AUTHORITIES = 1 (canonical only — legacy reconcile path removed)",
    canonicalAlive && 1 + denoReconcile.length <= BASELINE.PAYMENT_AUTHORITIES,
    `canonical=${canonicalAlive ? 1 : 0} + legacy=${denoReconcile.length} (baseline ${BASELINE.PAYMENT_AUTHORITIES})`,
  );

  // ── T4/T5: P2/P3 artifacts ต่อเข้าของเดิมจริง ──────────────────────────
  const registry = readFileSync(join(ROOT, "engines/connectors/registry.ts"), "utf8");
  check(
    "T4 LINE ConnectContract registered in the EXISTING Connect registry",
    /lineConnectContract/.test(registry) && /providers\/line/.test(registry),
  );
  const gatewayEvent = readFileSync(join(ROOT, "engines/integration-gateway/contracts/event.ts"), "utf8");
  check("T4 GatewayProvider includes line (type-only extension)", /"line"/.test(gatewayEvent));
  check(
    "T4/T5 LINE gateway adapter + canonical event writer + secret-gated bridge all exist",
    existsSafe("engines/integration-gateway/adapters/line.ts") &&
      existsSafe("engines/canonical/event-write.ts") &&
      existsSafe("app/api/internal/connect/event/route.ts"),
  );

  // ── T6 (P4b): receipt_documents สร้างผ่าน inbound bridge เท่านั้น ────────
  const inboundRoute = existsSafe("app/api/internal/connect/inbound-source/route.ts")
    ? readFileSync(join(ROOT, "app/api/internal/connect/inbound-source/route.ts"), "utf8")
    : "";
  check(
    "T6 inbound-source bridge exists and delegates to the canonical writer (no own insert)",
    inboundRoute.includes("recordInboundSource") && !/from\(\s*["']receipt_documents["']\s*\)/.test(stripComments(inboundRoute)),
  );
  for (const providerFile of [
    "supabase/functions/line-webhook-v2/engines/payment-claim.ts",
    "supabase/functions/line-webhook-v2/engines/process-classified-image.ts",
  ]) {
    const src = stripComments(readFileSync(join(ROOT, providerFile), "utf8"));
    check(
      `T6 ${providerFile.split("/").pop()} creates receipts via the Connect transport, never a direct insert`,
      src.includes("sendConnectInboundSource") && !/from\(\s*["']receipt_documents["']\s*\)\s*\.\s*insert/.test(src),
    );
  }

  // ── NC1: scanner ต้องจับได้จริง ไม่ใช่ empty matcher ───────────────────
  // fixture สร้างด้วย concatenation — แบบ probe ของ business-event-authority-test
  // (census ข้างนอกสแกน scripts/ ด้วย: ถ้าข้อความไฟล์นี้มี `.from(<table>)` chain
  // จริง D0 จะนับไฟล์นี้เป็น offender เอง — เทคนิคนี้มีบันทึกไว้ที่บรรทัด
  // 82-93 ของไฟล์นั้น)
  const NC_TABLE = "business_" + "events";
  const injected = "await db.from('" + NC_TABLE + "').insert({ a: 1 });";
  const nc = scanSource(injected, "<fixture>");
  check(
    "NC1 an injected events-table insert is detected by the same scanner",
    nc.writes.some((w) => w.table === NC_TABLE && w.op === "insert"),
    `detected ${nc.writes.length}`,
  );
  const commented = "// await db.from('" + NC_TABLE + "').insert({ a: 1 });";
  const nc2 = scanSource(commented, "<fixture-comment>");
  check("NC1b a commented-out write is NOT counted (comment stripping is real)", nc2.writes.length === 0);

  // NC2 (Phase-1 §9): a reintroduced reconcile RPC call must be caught —
  // fixture สร้างด้วย concatenation เหมือน NC1 (กัน D0 census ของ
  // business-event-authority นับไฟล์นี้เป็น offender)
  const NC_RPC = "reconcile_" + "receipt_payment";
  const ncRpc = scanSource("await client.rpc('" + NC_RPC + "', { p_receipt_id: id })", "<fixture-rpc>");
  check(
    "NC2 a reintroduced reconcile_receipt_payment rpc call is detected by the same scanner",
    ncRpc.rpcs.some((r) => r.name === NC_RPC),
    `detected ${ncRpc.rpcs.length}`,
  );

  console.log(`\n${pass}/${pass + failures.length} passed`);
  if (failures.length) {
    console.error(`FAILED: ${failures.join(" | ")}`);
    process.exit(1);
  }
  console.log(
    `census: deno ${deno.writes.length} write sites (business ${denoBusiness.length} · monetary ${denoMonetary.length}) · next business ${nextBusiness.length} · payment authority canonical 1 + legacy ${denoReconcile.length}`,
  );
}

function existsSafe(rel: string): boolean { try { statSync(join(ROOT, rel)); return true; } catch { return false; } }

main();

/** scanner ตัวเดียวที่ test และ NC ใช้ร่วมกัน (ไม่มีตัวที่สอง) */
export function scanSource(code: string, file: string): ScanResult {
  const s = stripComments(code);
  const writes: WriteSite[] = [];
  const rpcs: { file: string; name: string }[] = [];
  let m: RegExpExecArray | null;
  FROM_WRITE_RE.lastIndex = 0;
  while ((m = FROM_WRITE_RE.exec(s))) writes.push({ file, table: m[1], op: m[2] });
  RPC_RE.lastIndex = 0;
  while ((m = RPC_RE.exec(s))) rpcs.push({ file, name: m[1] });
  return { writes, rpcs };
}

function scanDirs(dirs: string[]): ScanResult {
  const writes: WriteSite[] = [];
  const rpcs: { file: string; name: string }[] = [];
  for (const d of dirs) {
    for (const f of walk(join(ROOT, d))) {
      const r = scanSource(readFileSync(f, "utf8"), f.replace(ROOT + "/", ""));
      writes.push(...r.writes);
      rpcs.push(...r.rpcs);
    }
  }
  return { writes, rpcs };
}

function isBusiness(w: WriteSite): boolean {
  return !EDGE_TABLES.has(w.table) && !CHORE_TABLES.has(w.table) &&
    !PLATFORM_ACCOUNTING_TABLES.has(w.table) && !MONETARY_TABLES.has(w.table);
}
