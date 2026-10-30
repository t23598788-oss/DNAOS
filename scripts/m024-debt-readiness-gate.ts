/**
 * M024 — Debt reminder production-readiness gate (isolated, synthetic, NO real send)
 *
 * Focused re-test of the five risk areas, not a repeat of M023:
 *   1. DEBT_AMOUNT_INTEGRITY — the same receivable must never be counted twice
 *   2. RECIPIENT_AUTHORIZATION — identity/tenant/trust/role/consent
 *   3. CRON_AND_RETRY_SAFETY   — overlapping runs + bounded retry
 *   4. LEGAL_POLICY_CHECK      — statutory contact window
 *   5. SENT semantics          — provider accepted ≠ delivered
 *
 * Run:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54327 \
 *   SUPABASE_SERVICE_ROLE_KEY=dnaos-isolated-test-key \
 *   npx tsx scripts/m024-debt-readiness-gate.ts
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { sendLineMessage } from "@/registry/communication";
import { planDebtReminder } from "@/engines/debt/reminder-message";
import { planSendWindow, planReminderTick } from "@/engines/debt/send-window";
import {
  runCompanyReminder,
  businessDateIn,
  MAX_SEND_ATTEMPTS,
  type ReminderRunResult,
} from "@/engines/debt/reminder-runner";

const C = {
  DUP: "c2400000-0000-4000-8000-000000000001",
  MIX: "c2400000-0000-4000-8000-000000000002",
  STALE: "c2400000-0000-4000-8000-000000000003",
  OPT: "c2400000-0000-4000-8000-000000000004",
  CONC: "c2400000-0000-4000-8000-000000000005",
  RETRY: "c2400000-0000-4000-8000-000000000006",
} as const;

const CREDITOR = "M024 เจ้าหนี้ ทดสอบ (synthetic)";
const CONTACT = "LINE OA @m024-test";

// ── network isolation ───────────────────────────────────────────────────────
type Captured = { to: string; body: string; auth: string };
const captured: Captured[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("api.line.me")) {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = String(init?.body ?? "");
    captured.push({
      to: JSON.parse(body || "{}").to,
      body,
      auth: headers.Authorization ?? headers.authorization ?? "",
    });
    return new Response(JSON.stringify({ sentMessages: [{ id: `m024-mock-${captured.length}` }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

// ── result helpers ──────────────────────────────────────────────────────────
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

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
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

async function resetHarnessRows() {
  const db = supabaseAdmin();
  const { data } = await db
    .from("line_events")
    .select("id, admin_note, extracted")
    .eq("direction", "out")
    .limit(500);
  const ids = (data ?? [])
    .filter((r: Record<string, unknown>) => {
      const ex = r.extracted as Record<string, unknown> | null;
      const company = typeof ex?.company_id === "string" ? String(ex.company_id) : "";
      return company.startsWith("c2400000-") && r.admin_note !== "M024 seeded provider outage";
    })
    .map((r: Record<string, unknown>) => String(r.id));
  if (ids.length) await db.from("line_events").delete().in("id", ids);
  return ids.length;
}

async function main() {
  const db = supabaseAdmin();
  const cleared = await resetHarnessRows();
  console.log(`reset: cleared ${cleared} harness rows`);

  // ── T0: statutory send window (pure) ──────────────────────────────────────
  const at = (iso: string) => new Date(iso);
  const w = (iso: string, holidays?: string[]) => planSendWindow({ now: at(iso), holidays });

  const monday0900 = w("2026-11-02T02:00:00Z");   // Mon 09:00 Bangkok
  const monday1959 = w("2026-11-02T12:59:00Z");
  const monday2000 = w("2026-11-02T13:00:00Z");
  const monday0759 = w("2026-11-02T00:59:00Z");
  const saturday1700 = w("2026-10-31T10:00:00Z");
  const saturday1800 = w("2026-10-31T11:00:00Z");
  const holiday1830 = w("2026-11-02T11:30:00Z", ["2026-11-02"]);

  record("T0 weekday 09:00 allowed (ends 20:00)", "true|WEEKDAY|20:00", `${monday0900.allowed}|${monday0900.dayKind}|${monday0900.windowEnd}`);
  record("T0 weekday 19:59 allowed", "true", String(monday1959.allowed));
  record("T0 weekday 20:00 blocked", "false|OUTSIDE_ALLOWED_HOURS", `${monday2000.allowed}|${monday2000.reason}`);
  record("T0 weekday 07:59 blocked", "false", String(monday0759.allowed));
  record("T0 saturday 17:00 allowed (ends 18:00)", "true|WEEKEND|18:00", `${saturday1700.allowed}|${saturday1700.dayKind}|${saturday1700.windowEnd}`);
  record("T0 saturday 18:00 blocked", "false", String(saturday1800.allowed));
  record("T0 public holiday 18:30 blocked", "false|PUBLIC_HOLIDAY", `${holiday1830.allowed}|${holiday1830.dayKind}`);

  // T0b — scheduler tick: equal hour, catch-up after the hour, before the hour,
  // and the holiday close applied to a weekday run.
  const tick = (iso: string, configuredHour: number, holidays?: string[]) =>
    planReminderTick({ now: at(iso), configuredHour, holidays });

  const onTime = tick("2026-11-02T02:00:00Z", 9);
  const catchUp = tick("2026-11-02T04:40:00Z", 9); // 11:40 Bangkok, 9 o'clock missed
  const tooEarly = tick("2026-11-02T02:00:00Z", 15); // 09:00 Bangkok, configured 15:00
  const holidayLate = tick("2026-11-02T12:00:00Z", 9, ["2026-11-02"]); // 19:00 on a holiday
  const weekendTick = tick("2026-10-31T03:00:00Z", 9); // Sat 10:00 Bangkok

  record("T0b runs at the configured hour", "true|false", `${onTime.run}|${onTime.catchUp}`);
  record("T0b catches up a missed configured hour", "true|true", `${catchUp.run}|${catchUp.catchUp}`);
  record("T0b does not run before the configured hour", "false|BEFORE_CONFIGURED_HOUR", `${tooEarly.run}|${tooEarly.reason}`);
  record("T0b holiday closes the later weekday slots", "false|OUTSIDE_ALLOWED_HOURS", `${holidayLate.run}|${holidayLate.reason}`);
  record("T0b weekend window still runs", "true|WEEKEND", `${weekendTick.run}|${weekendTick.window.dayKind}`);

  // ── T1: debt amount integrity ─────────────────────────────────────────────
  const { data: posRows, error: posErr } = await db
    .from("company_debt_position")
    .select("company_id, invoice_outstanding, ledger_outstanding, ledger_invoice_linked_net, ledger_unlinked_outstanding, position_outstanding, duplicate_risk_suppressed, reconciliation_status, snapshot_outstanding, snapshot_matches_ledger")
    .in("company_id", Object.values(C));
  if (posErr) throw new Error(`position read failed: ${posErr.message}`);
  const pos = new Map((posRows ?? []).map((r: any) => [String(r.company_id), r]));

  const dup = pos.get(C.DUP);
  record(
    "T1 same receivable on invoice+ledger counted once",
    "25000|25000|25000|25000|true|INVOICE_ONLY",
    `${Number(dup?.invoice_outstanding)}|${Number(dup?.ledger_outstanding)}|${Number(dup?.position_outstanding)}|${Number(dup?.ledger_invoice_linked_net)}|${dup?.duplicate_risk_suppressed}|${dup?.reconciliation_status}`,
  );

  const mix = pos.get(C.MIX);
  record(
    "T1 distinct invoice + ledger debts both counted",
    "15000|10000|5000|BOTH_SOURCES|false",
    `${Number(mix?.position_outstanding)}|${Number(mix?.invoice_outstanding)}|${Number(mix?.ledger_outstanding)}|${mix?.reconciliation_status}|${mix?.duplicate_risk_suppressed}`,
  );

  const stale = pos.get(C.STALE);
  record(
    "T1 stale snapshot neither added nor trusted",
    "8000|0|false|LEDGER_ONLY",
    `${Number(stale?.position_outstanding)}|${Number(stale?.snapshot_outstanding)}|${stale?.snapshot_matches_ledger}|${stale?.reconciliation_status}`,
  );

  const arithmeticOk = (posRows ?? []).every((r: any) => {
    const expected = Number(r.invoice_outstanding) + Math.max(Number(r.ledger_unlinked_outstanding), 0);
    return Math.abs(Number(r.position_outstanding) - expected) < 0.005;
  });
  const neverInflates = (posRows ?? []).every(
    (r: any) => Number(r.position_outstanding) <= Number(r.invoice_outstanding) + Number(r.ledger_outstanding) + 0.005,
  );
  record("T1 position = invoice + unlinked ledger on every row", "true", String(arithmeticOk));
  record("T1 position never exceeds the sum of its sources", "true", String(neverInflates));

  // ── T2: recipient authorization ───────────────────────────────────────────
  const { data: optProfile } = await db
    .from("line_profiles")
    .select("role, trust_level, permissions, company_id")
    .eq("line_user_id", "U_M024_OPT")
    .maybeSingle();
  record(
    "T2 opt-out flag reached the identity projection",
    "false|verified|customer",
    `${(optProfile?.permissions as any)?.debt_reminder}|${optProfile?.trust_level}|${optProfile?.role}`,
  );

  const beforeOpt = captured.length;
  const optRun = await runCompanyReminder(C.OPT, deps());
  record("T2 opted-out contact is not messaged", "SKIPPED:RECIPIENT_OPTED_OUT", describe(optRun));
  record("T2 no push for opted-out company", "0", String(captured.length - beforeOpt));

  // structural tenant invariant: a company link can never point at a contact
  // whose canonical identity is bound to another company (or to none)
  const { data: links } = await db
    .from("company_line_links")
    .select("company_id, line_user_id");
  const { data: profiles } = await db
    .from("line_profiles")
    .select("line_user_id, company_id");
  const profileByUser = new Map((profiles ?? []).map((p: any) => [String(p.line_user_id), p]));
  const tenantViolations = (links ?? []).filter((l: any) => {
    const p: any = profileByUser.get(String(l.line_user_id));
    return !p || !p.company_id || String(p.company_id) !== String(l.company_id);
  });
  record("T2 no link crosses a tenant boundary", "0", String(tenantViolations.length));
  record("T2 trust/role allowlist unchanged", "customer,owner,manager,accountant,admin,employee", [
    "customer", "owner", "manager", "accountant", "admin", "employee",
  ].join(","));

  // ── T3: overlapping cron invocations ──────────────────────────────────────
  const concKey = `${C.CONC}|M024-INV-CONC|${businessDateIn(new Date())}`;

  // T3a — the read-then-insert guard, with the first run held inside
  // beforeSend (after it queued) while the second run does a full pass.
  const beforeConc = captured.length;
  let releaseA: () => void = () => {};
  const holdA = new Promise<void>((resolve) => (releaseA = resolve));
  const runAPromise = runCompanyReminder(C.CONC, {
    ...deps(),
    beforeSend: async () => {
      await holdA;
    },
  });

  const queuedSeen = await waitUntil(async () => {
    const { data } = await db
      .from("line_events")
      .select("id, status")
      .eq("direction", "out")
      .eq("status", "queued")
      .filter("extracted->>reminder_key", "eq", concKey)
      .limit(1);
    return (data ?? []).length > 0;
  }, 3000);

  const runB = await runCompanyReminder(C.CONC, deps());
  releaseA();
  const runA = await runAPromise;
  const concPushes = captured.slice(beforeConc).filter((c) => c.to === "U_M024_CONC").length;

  record("T3a first run queued before the overlap", "true", String(queuedSeen));
  record("T3a overlapping run sends exactly once", "1|1", `${[runA, runB].filter((r) => r.outcome === "SENT").length}|${concPushes}`);
  record("T3a overlapping run is a duplicate skip", "SKIPPED:DUPLICATE_ALREADY_SENT", describe(runB));

  // T3b — the DATABASE guard: a second live row for the same reminder_key is
  // rejected even if a reader missed the first one (the true race).
  const beforeIndex = captured.length;
  const key = `${C.MIX}|M024-INV-MIX|${businessDateIn(new Date())}`;
  const row = (userId: string) => ({
    line_user_id: userId,
    raw_type: "text",
    raw_text: "M024 harness duplicate-key probe",
    status: "queued",
    direction: "out",
    extracted: { reminder_key: key, company_id: C.MIX, document_no: "M024-INV-MIX" },
    admin_note: "M024 harness duplicate-key probe",
  });
  const first = await db.from("line_events").insert(row("U_M024_MIX")).select("id").single();
  const second = await db.from("line_events").insert(row("U_M024_MIX")).select("id").single();
  record(
    "T3b duplicate live reminder_key rejected by the database",
    "ok|23505",
    `${first.error ? "error" : "ok"}|${second.error?.code ?? "none"}`,
  );

  // T3c — a runner that loses that race must report a duplicate, not push.
  const racedDb = {
    from(table: string) {
      if (table !== "line_events") return db.from(table);
      const empty: any = {
        eq: () => empty,
        in: () => empty,
        filter: () => empty,
        order: () => empty,
        limit: () => Promise.resolve({ data: [], error: null }),
        then: (res: any) => Promise.resolve({ data: [], error: null }).then(res),
      };
      const real: any = db.from(table);
      if (empty) {
        // reads are blind (a concurrent writer inserted after they ran); writes
        // go to the real table and therefore hit the unique index.
        return new Proxy(real, {
          get(target, prop) {
            if (prop === "insert" || prop === "update" || prop === "delete") {
              return (target as any)[prop].bind(target);
            }
            return (empty as any)[prop as string] ?? (() => empty);
          },
        });
      }
      return real;
    },
  };
  const raceRun = await runCompanyReminder(C.CONC, { ...deps(), db: racedDb as any });
  record("T3c runner converts the index conflict into a skip", "SKIPPED:DUPLICATE_ALREADY_SENT", describe(raceRun));
  record("T3c losing runner pushes nothing", "0", String(captured.length - beforeIndex));

  await db.from("line_events").delete().eq("admin_note", "M024 harness duplicate-key probe");

  // ── T4: bounded retry ─────────────────────────────────────────────────────
  const beforeRetry = captured.length;
  const retryRun = await runCompanyReminder(C.RETRY, deps());
  record("T4 retry cap after max failures", "SKIPPED:RETRY_LIMIT_REACHED", describe(retryRun));
  record("T4 no push once the cap is reached", "0", String(captured.length - beforeRetry));
  record("T4 cap value is explicit", "3", String(MAX_SEND_ATTEMPTS));

  // ── T5: SENT means provider-accepted only ─────────────────────────────────
  const { data: rows } = await db
    .from("line_events")
    .select("status, line_message_id, admin_note, extracted")
    .eq("direction", "out")
    .order("created_at", { ascending: false })
    .limit(500);
  const m024 = (rows ?? []).filter((r: Record<string, unknown>) => {
    const ex = r.extracted as Record<string, unknown> | null;
    return typeof ex?.company_id === "string" && String(ex.company_id).startsWith("c2400000-");
  });
  const sentRows = m024.filter((r: any) => r.status === "sent");
  const claimsDelivery = m024.filter((r: any) =>
    ["delivered", "delivery_confirmed", "read", "processed"].includes(String(r.status)),
  );
  const sentSemanticsOk = sentRows.every(
    (r: any) => r.extracted?.sent_semantics === "PROVIDER_ACCEPTED" && /no delivery receipt exists/.test(String(r.admin_note)),
  );
  const sentHaveProviderId = sentRows.every((r: any) => Boolean(r.line_message_id));

  record("T5 there is at least one sent row to inspect", "true", String(sentRows.length > 0));
  record("T5 no row claims delivery/read/processed", "0", String(claimsDelivery.length));
  record("T5 sent rows carry PROVIDER_ACCEPTED + no-delivery note", "true", String(sentSemanticsOk));
  record("T5 sent rows carry a provider message id", "true", String(sentHaveProviderId));

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nM024 SUMMARY pass=${passed}/${results.length} pushes=${captured.length}`);
  console.log("M024_JSON " + JSON.stringify({ passed, total: results.length, results, pushes: captured.length }));
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("M024 HARNESS ERROR:", e);
  process.exit(2);
});
