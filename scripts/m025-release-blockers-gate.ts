/**
 * M025 — Debt reminder release-blocker gate (isolated, synthetic, NO real send)
 *
 * Covers only what M025 changed:
 *   1. holiday calendar provenance + fail-closed gate (no assumed dates)
 *   2. snapshot ↔ ledger parity and suppression of the unverified legacy card
 *   3. debt-reminder consent through Connect Identity (existing Contact Settings)
 *   4. failure / stuck-queued visibility, with SENT = PROVIDER_ACCEPTED
 *
 * Run:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54327 \
 *   SUPABASE_SERVICE_ROLE_KEY=dnaos-isolated-test-key \
 *   npx tsx scripts/m025-release-blockers-gate.ts
 */
import { readFileSync } from "fs";
import { supabaseAdmin } from "@/services/supabase/queries";
import { sendLineMessage } from "@/registry/communication";
import { planDebtReminder } from "@/engines/debt/reminder-message";
import { planReminderTick } from "@/engines/debt/send-window";
import { resolveHolidayCalendar } from "@/engines/debt/holiday-calendar";
import { compareSnapshotToLedger } from "@/engines/debt/snapshot-parity";
import { runCompanyReminder, businessDateIn, type ReminderRunResult } from "@/engines/debt/reminder-runner";
import { linkExternalIdentity, resolveExternalIdentity } from "@/engines/connect/identity";
import { getDebtReminderHealth } from "@/services/debt/reminder-health";

const C = { FAIL: "c2500000-0000-4000-8000-000000000001" } as const;
const CREDITOR = "M025 เจ้าหนี้ ทดสอบ (synthetic)";
const CONTACT = "LINE OA @m025-test";

// ── network isolation ───────────────────────────────────────────────────────
const captured: { to: string; body: string }[] = [];
let lineMode: "ok" | "fail" = "ok";
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("api.line.me")) {
    const body = String(init?.body ?? "");
    captured.push({ to: JSON.parse(body || "{}").to, body });
    if (lineMode === "fail") return new Response("line: simulated outage", { status: 503 });
    return new Response(JSON.stringify({ sentMessages: [{ id: `m025-mock-${captured.length}` }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

const results: { name: string; expected: string; actual: string; pass: boolean }[] = [];
function record(name: string, expected: string, actual: string) {
  const pass = expected === actual;
  results.push({ name, expected, actual, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — expected=${expected} actual=${actual}`);
}
function describe(r: ReminderRunResult | undefined): string {
  if (!r) return "MISSING";
  return r.outcome === "SKIPPED" ? `SKIPPED:${r.reason}` : r.outcome;
}

const deps = () => ({
  db: supabaseAdmin(),
  send: async (to: string, messages: unknown[]) => {
    const res = await sendLineMessage(supabaseAdmin(), to, messages as any[]);
    return { ok: res.success, messageId: res.messageId ?? null, error: res.error };
  },
  compose: planDebtReminder,
  creditorName: CREDITOR,
  contactChannel: CONTACT,
  windowDays: 7,
});

const officialDoc = (year: number, days: { date: string; label: string; kind: "annual" | "special" }[]) =>
  JSON.stringify({
    schema_version: 1,
    years: {
      [String(year)]: {
        source_url: "https://www.bot.or.th/th/financial-institutions-holiday.html",
        source_name: "ธนาคารแห่งประเทศไทย — วันหยุดสถาบันการเงิน",
        verified_at: "2026-10-31",
        days,
      },
    },
  });

async function main() {
  const db = supabaseAdmin();

  // ── T1: holiday calendar provenance ───────────────────────────────────────
  const shipped = readFileSync("registry/communication/th-holidays.json", "utf8");
  const shipped2026 = resolveHolidayCalendar({ raw: shipped, year: 2026 });
  record("T1 shipped manifest assumes no dates", "YEAR_NOT_PUBLISHED", shipped2026.status);
  record("T1 shipped manifest has no usable dates", "0", String(shipped2026.dates.length));
  record("T1 missing config is MISSING", "MISSING", resolveHolidayCalendar({ raw: null, year: 2026 }).status);
  record("T1 broken JSON is MALFORMED", "MALFORMED", resolveHolidayCalendar({ raw: "{oops", year: 2026 }).status);

  const privateSource = JSON.stringify({
    years: { "2027": { source_url: "https://example.com/holidays", source_name: "blog", verified_at: "2026-10-31", days: [{ date: "2027-01-01", label: "x", kind: "annual" }] } },
  });
  record("T1 non-official source rejected", "UNVERIFIED_SOURCE", resolveHolidayCalendar({ raw: privateSource, year: 2027 }).status);

  const outOfYear = officialDoc(2027, [{ date: "2028-01-01", label: "x", kind: "annual" }]);
  record("T1 date outside the year rejected", "INVALID_DAYS", resolveHolidayCalendar({ raw: outOfYear, year: 2027 }).status);

  const dupes = officialDoc(2027, [
    { date: "2027-01-01", label: "วันขึ้นปีใหม่", kind: "annual" },
    { date: "2027-01-01", label: "ซ้ำ", kind: "annual" },
  ]);
  record("T1 duplicate day rejected", "INVALID_DAYS", resolveHolidayCalendar({ raw: dupes, year: 2027 }).status);

  const verifiedDoc = officialDoc(2027, [
    { date: "2027-01-01", label: "วันขึ้นปีใหม่", kind: "annual" },
    { date: "2027-06-02", label: "วันหยุดเพิ่มเป็นกรณีพิเศษ", kind: "special" },
  ]);
  const verified = resolveHolidayCalendar({ raw: verifiedDoc, year: 2027 });
  record("T1 official source accepted", "VERIFIED|2|2", `${verified.status}|${verified.dayCount}|${verified.dates.length}`);
  record("T1 special holiday kept distinct", "true", String(verified.dates.includes("2027-06-02")));

  // gate integration: holiday closes at 18:00, ordinary weekday at 20:00
  const tick = (iso: string, holidays: string[]) => planReminderTick({ now: new Date(iso), configuredHour: 9, holidays });
  const holiday1900 = tick("2027-01-01T12:00:00Z", verified.dates);   // Fri 19:00 on a holiday
  const holiday1700 = tick("2027-01-01T10:00:00Z", verified.dates);   // Fri 17:00 on a holiday
  const normal1900 = tick("2027-01-04T12:00:00Z", verified.dates);    // Mon 19:00, not a holiday
  record("T1 holiday 19:00 blocked", "false|OUTSIDE_ALLOWED_HOURS", `${holiday1900.run}|${holiday1900.reason}`);
  record("T1 holiday 17:00 allowed", "true|PUBLIC_HOLIDAY|18:00", `${holiday1700.run}|${holiday1700.window.dayKind}|${holiday1700.window.windowEnd}`);
  record("T1 ordinary weekday 19:00 allowed", "true|WEEKDAY|20:00", `${normal1900.run}|${normal1900.window.dayKind}|${normal1900.window.windowEnd}`);

  // ── T2: snapshot ↔ ledger parity (pure) ───────────────────────────────────
  const pMatch = compareSnapshotToLedger({ snapshot: 25000, ledger: 25000, ledgerEventCount: 1 });
  const pMismatch = compareSnapshotToLedger({ snapshot: 5000, ledger: 0, ledgerEventCount: 3 });
  const pNoSnapshot = compareSnapshotToLedger({ snapshot: null, ledger: 8000, ledgerEventCount: 1 });
  const pUnreadable = compareSnapshotToLedger({ snapshot: 100, ledger: null });
  record("T2 equal figures verify", "MATCH|true", `${pMatch.status}|${pMatch.verified}`);
  record("T2 drifted snapshot is unverified", "MISMATCH|false|5000", `${pMismatch.status}|${pMismatch.verified}|${pMismatch.delta}`);
  record("T2 ledger without snapshot is unverified", "NO_SNAPSHOT|false", `${pNoSnapshot.status}|${pNoSnapshot.verified}`);
  record("T2 unreadable ledger is unverified", "UNREADABLE|false", `${pUnreadable.status}|${pUnreadable.verified}`);

  // ── T3: parity against real rows ──────────────────────────────────────────
  const { data: realRows } = await db
    .from("company_debt_position")
    .select("company_id, ledger_outstanding, ledger_invoice_linked_net, snapshot_outstanding")
    .in("company_id", [
      "c2400000-0000-4000-8000-000000000001",
      "c2400000-0000-4000-8000-000000000003",
    ]);
  const byId = new Map((realRows ?? []).map((r: any) => [String(r.company_id), r]));
  const stale = byId.get("c2400000-0000-4000-8000-000000000003");
  const staleParity = compareSnapshotToLedger({
    snapshot: Number(stale?.snapshot_outstanding),
    ledger: Number(stale?.ledger_outstanding),
  });
  record(
    "T3 stale snapshot row would be suppressed",
    "MISMATCH|0|8000",
    `${staleParity.status}|${staleParity.snapshot}|${staleParity.ledger}`,
  );

  // ── T4: consent through Connect Identity ──────────────────────────────────
  await linkExternalIdentity(db, {
    provider: "line",
    externalSubjectId: "U_M025_FAIL",
    permissions: { debt_reminder: false },
    actor: "m025-harness",
  });
  const stored = await resolveExternalIdentity(db, { provider: "line", externalSubjectId: "U_M025_FAIL" });
  record("T4 opt-out stored on the canonical identity", "false", String(stored?.permissions?.debt_reminder));

  const beforeOpt = captured.length;
  const optRun = await runCompanyReminder(C.FAIL, deps());
  record("T4 opted-out contact blocked", "SKIPPED:RECIPIENT_OPTED_OUT", describe(optRun));
  record("T4 no push while opted out", "0", String(captured.length - beforeOpt));

  await linkExternalIdentity(db, {
    provider: "line",
    externalSubjectId: "U_M025_FAIL",
    permissions: { debt_reminder: true },
    actor: "m025-harness",
  });

  // ── T5: failure path + health surface ─────────────────────────────────────
  lineMode = "fail";
  const failed = await runCompanyReminder(C.FAIL, deps());
  lineMode = "ok";
  record("T5 outage recorded as FAILED", "FAILED", describe(failed));

  const healthAfterFail = await getDebtReminderHealth(db, { windowHours: 24, stuckMinutes: 15 });
  const ours = healthAfterFail.failures.find((f) => f.companyId === C.FAIL);
  record("T5 health lists the failure", "true", String(Boolean(ours)));
  record("T5 failure carries the provider error", "true", String(/simulated outage/.test(String(ours?.error))));
  record("T5 stuck queued row is visible", "1", String(healthAfterFail.stuckQueued));
  record("T5 no delivery claim exists", "0|PROVIDER_ACCEPTED", `${healthAfterFail.deliveryConfirmed}|${healthAfterFail.sentMeans}`);

  const retried = await runCompanyReminder(C.FAIL, deps());
  record("T5 retry after recovery sends once", "SENT", describe(retried));
  const healthAfterRetry = await getDebtReminderHealth(db, { windowHours: 24, stuckMinutes: 15 });
  record("T5 health counts the accepted message", "true", String(healthAfterRetry.sent >= 1));

  // ── T6: SENT semantics on the persisted rows ──────────────────────────────
  const { data: rows } = await db
    .from("line_events")
    .select("status, admin_note, extracted, line_message_id")
    .eq("direction", "out")
    .eq("line_user_id", "U_M025_FAIL")
    .order("created_at", { ascending: false })
    .limit(20);
  const sentRows = (rows ?? []).filter((r: any) => r.status === "sent");
  const claimsDelivery = (rows ?? []).filter((r: any) =>
    ["delivered", "delivery_confirmed", "read", "processed"].includes(String(r.status)),
  );
  record("T6 sent rows are provider-accepted only", "true", String(
    sentRows.length > 0 &&
      sentRows.every((r: any) => r.extracted?.sent_semantics === "PROVIDER_ACCEPTED" && /no delivery receipt/.test(String(r.admin_note))),
  ));
  record("T6 no row claims delivery or reading", "0", String(claimsDelivery.length));

  // restore the fixture consent state
  await linkExternalIdentity(db, {
    provider: "line",
    externalSubjectId: "U_M025_FAIL",
    permissions: {},
    actor: "m025-harness",
  });

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nM025 SUMMARY pass=${passed}/${results.length} pushes=${captured.length}`);
  console.log("M025_JSON " + JSON.stringify({ passed, total: results.length, results, pushes: captured.length }));
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("M025 HARNESS ERROR:", e);
  process.exit(2);
});
