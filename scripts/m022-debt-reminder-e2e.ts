/**
 * M022 — Debt reminder end-to-end acceptance (isolated, synthetic, NO real LINE send)
 *
 * Runs the REAL Node-side pieces:
 *   canonical invoice/debt reader (invoice_payment_summary + invoices + company_debt_current)
 *   real recipient selection (company_line_links + line_profiles authorization)
 *   real idempotency store (line_events, direction=out)
 *   real outbound gateway (registry/communication.sendLineMessage)
 *   real scheduler (engines/debt/scheduler.ts)
 * plus the pure 3-state composer (engines/debt/reminder-message.ts).
 *
 * The only fake is the network: global fetch is intercepted and answered
 * locally, so no message can reach LINE. Every call is recorded.
 *
 * Run:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54327 \
 *   SUPABASE_SERVICE_ROLE_KEY=dnaos-isolated-test-key \
 *   npx tsx scripts/m022-debt-reminder-e2e.ts
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { getCanonicalCompanyDebt } from "@/services/canonical/payments";
import { sendLineMessage } from "@/registry/communication";
import { checkDebtSchedule } from "@/engines/debt/scheduler";
import { confirmPayment } from "@/engines/canonical/payment-write";
import { planDebtReminder, type ReminderState } from "@/engines/debt/reminder-message";

const COMPANIES = {
  NOT_DUE: "c2200000-0000-4000-8000-000000000001",
  PRE_DUE: "c2200000-0000-4000-8000-000000000002",
  DUE_TODAY: "c2200000-0000-4000-8000-000000000003",
  OVERDUE_PARTIAL: "c2200000-0000-4000-8000-000000000004",
  PAID: "c2200000-0000-4000-8000-000000000005",
  NO_RECIPIENT: "c2200000-0000-4000-8000-000000000006",
  DUPLICATE: "c2200000-0000-4000-8000-000000000007",
  LINE_FAILURE: "c2200000-0000-4000-8000-000000000008",
  RACE: "c2200000-0000-4000-8000-000000000009",
} as const;

const CREDITOR = "M022 เจ้าหนี้ ทดสอบ (synthetic)";
const CONTACT = "LINE OA @m022-test";

type CaseResult = {
  case: string;
  expected: string;
  actual: string;
  pass: boolean;
  detail?: Record<string, unknown>;
};

const results: CaseResult[] = [];
function record(
  name: string,
  expected: string,
  actual: string,
  detail?: Record<string, unknown>,
) {
  const pass = expected === actual;
  results.push({ case: name, expected, actual, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — expected=${expected} actual=${actual}`);
  if (detail) console.log("     " + JSON.stringify(detail));
}

// ── network isolation ───────────────────────────────────────────────────────
type CapturedCall = { url: string; to: string; body: string };
const captured: CapturedCall[] = [];
let lineMode: "ok" | "fail" = "ok";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("api.line.me")) {
    const body = String(init?.body ?? "");
    captured.push({ url, to: JSON.parse(body || "{}").to, body });
    if (lineMode === "fail") {
      return new Response("line: simulated outage", { status: 503 });
    }
    return new Response(JSON.stringify({ sentMessages: [{ id: `m022-mock-${captured.length}` }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

// ── date semantics ─────────────────────────────────────────────────────────
// invoices.due_date is a timestamp written with Bangkok wall-clock meaning.
// Reading it as a raw UTC slice shifts the calendar day, so every date used by
// the planner is normalised to the business timezone first.
const BIZ_TZ = "Asia/Bangkok";

function businessDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BIZ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// ── canonical read (invoice truth) ─────────────────────────────────────────
type InvoiceDebt = {
  invoiceId: string;
  invoiceNo: string;
  dueDate: string;
  receivable: number;
  paid: number;
  outstanding: number;
  derivedStatus: string;
};

async function readCompanyInvoiceDebt(companyId: string): Promise<{
  invoices: InvoiceDebt[];
  receivable: number;
  paid: number;
  outstanding: number;
  companyLedger: number | null;
  snapshot: number | null;
}> {
  const db = supabaseAdmin();
  const { data: invs, error } = await db
    .from("invoices")
    .select("id, invoice_no, due_date")
    .eq("customer_company_id", companyId);
  if (error) throw new Error(`invoices read failed: ${error.message}`);
  const ids = (invs ?? []).map((i: Record<string, unknown>) => String(i.id));
  const { data: sums } = ids.length
    ? await db.from("invoice_payment_summary").select("*").in("invoice_id", ids)
    : { data: [] as Record<string, unknown>[] };
  const byId = new Map((sums ?? []).map((s: Record<string, unknown>) => [String(s.invoice_id), s]));

  const invoices: InvoiceDebt[] = (invs ?? [])
    .map((i: Record<string, unknown>) => {
      const s = byId.get(String(i.id)) ?? {};
      return {
        invoiceId: String(i.id),
        invoiceNo: String(i.invoice_no),
        dueDate: businessDate(String(i.due_date ?? "")),
        receivable: Number(s.receivable_amount ?? 0),
        paid: Number(s.paid_amount ?? 0),
        outstanding: Number(s.outstanding ?? 0),
        derivedStatus: String(s.derived_status ?? "UNKNOWN"),
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const ledger = (await getCanonicalCompanyDebt(companyId)) as Record<string, unknown> | null;
  const { data: snap } = await db
    .from("debt_snapshots")
    .select("total_outstanding")
    .eq("customer_company_id", companyId)
    .maybeSingle();

  return {
    invoices,
    receivable: round2(invoices.reduce((a, i) => a + i.receivable, 0)),
    paid: round2(invoices.reduce((a, i) => a + i.paid, 0)),
    outstanding: round2(invoices.reduce((a, i) => a + i.outstanding, 0)),
    companyLedger: ledger ? Number(ledger.ledger_outstanding ?? 0) : null,
    snapshot: snap ? Number((snap as Record<string, unknown>).total_outstanding ?? 0) : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── recipient authorization ─────────────────────────────────────────────────
const ALLOWED_ROLES = new Set(["customer", "manager", "accountant", "owner"]);

async function selectAuthorizedRecipient(companyId: string): Promise<
  | { ok: true; lineUserId: string; trust: string; role: string }
  | { ok: false; reason: "NO_LINK" | "NO_PROFILE" | "NOT_VERIFIED" | "ROLE_NOT_ALLOWED" }
> {
  const db = supabaseAdmin();
  const { data: link } = await db
    .from("company_line_links")
    .select("line_user_id")
    .eq("company_id", companyId)
    .maybeSingle();
  if (!link?.line_user_id) return { ok: false, reason: "NO_LINK" };

  const { data: profile } = await db
    .from("line_profiles")
    .select("trust_level, role")
    .eq("line_user_id", link.line_user_id)
    .maybeSingle();
  if (!profile) return { ok: false, reason: "NO_PROFILE" };
  if (profile.trust_level !== "verified") return { ok: false, reason: "NOT_VERIFIED" };
  if (!ALLOWED_ROLES.has(String(profile.role))) return { ok: false, reason: "ROLE_NOT_ALLOWED" };
  return {
    ok: true,
    lineUserId: String(link.line_user_id),
    trust: String(profile.trust_level),
    role: String(profile.role),
  };
}

// ── idempotency (line_events out rows) ─────────────────────────────────────
async function findExistingSend(reminderKey: string) {
  const db = supabaseAdmin();
  const { data } = await db
    .from("line_events")
    .select("id, status, line_message_id, extracted, created_at")
    .eq("direction", "out")
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []).find((r: Record<string, unknown>) => {
    const ex = r.extracted as Record<string, unknown> | null;
    return ex?.reminder_key === reminderKey && ["queued", "sent", "delivery_confirmed"].includes(String(r.status));
  });
}

// ── one reminder attempt ───────────────────────────────────────────────────
type Outcome =
  | { action: "SENT" | "FAILED"; state: ReminderState; key: string; text: string; messageId: string | null; status: string }
  | { action: "SKIP"; reason: string };

async function attemptReminder(
  companyId: string,
  asOf: Date,
  opts: { beforeSend?: () => Promise<void> } = {},
): Promise<Outcome> {
  const debt = await readCompanyInvoiceDebt(companyId);

  // oldest unpaid invoice is the reminder subject — read, never computed
  const target = debt.invoices.find((i) => i.outstanding > 0) ?? debt.invoices[0];
  if (!target) return { action: "SKIP", reason: "NO_DEBT" };

  const recipient = await selectAuthorizedRecipient(companyId);
  if (!recipient.ok) return { action: "SKIP", reason: `RECIPIENT_${recipient.reason}` };

  const plan = planDebtReminder({
    creditorName: CREDITOR,
    debtorName: undefined,
    documentNo: target.invoiceNo,
    dueDate: target.dueDate,
    asOf,
    outstanding: target.outstanding,
    contactChannel: CONTACT,
    reminderKey: `${companyId}|${target.invoiceNo}|${asOf.toISOString().slice(0, 10)}`,
  });
  if (plan.action === "SKIP") return { action: "SKIP", reason: plan.reason };

  const existing = await findExistingSend(plan.message.reminderKey);
  if (existing) return { action: "SKIP", reason: "DUPLICATE_ALREADY_SENT" };

  if (opts.beforeSend) await opts.beforeSend();

  // re-read immediately before sending: payment may have landed while composing
  const fresh = await readCompanyInvoiceDebt(companyId);
  const freshTarget = fresh.invoices.find((i) => i.invoiceId === target.invoiceId);
  if (!freshTarget || freshTarget.outstanding <= 0) {
    return { action: "SKIP", reason: "PAID_SINCE_PREPARE" };
  }
  if (Math.abs(freshTarget.outstanding - target.outstanding) > 0.001) {
    return { action: "SKIP", reason: "BALANCE_CHANGED_SINCE_PREPARE" };
  }

  const db = supabaseAdmin();
  const { data: queued, error: queueErr } = await db
    .from("line_events")
    .insert({
      line_user_id: recipient.lineUserId,
      raw_type: "text",
      raw_text: plan.message.text,
      status: "queued",
      direction: "out",
      extracted: {
        reminder_key: plan.message.reminderKey,
        reminder_state: plan.message.state,
        template: "m022-reminder/1",
        document_no: target.invoiceNo,
        outstanding_read_at: new Date().toISOString(),
        amount_read: target.outstanding,
        company_id: companyId,
      },
    })
    .select("id")
    .single();
  if (queueErr || !queued) throw new Error(`queue write failed: ${queueErr?.message}`);

  const sent = await sendLineMessage(db, recipient.lineUserId, [
    { type: "text", text: plan.message.text },
  ]);

  const status = sent.success ? "sent" : "failed";
  await db
    .from("line_events")
    .update({
      status,
      line_message_id: sent.success ? (sent.messageId ?? null) : null,
      admin_note: sent.success ? null : (sent.error ?? "unknown error").slice(0, 500),
    })
    .eq("id", queued.id);

  if (!sent.success) {
    return {
      action: "FAILED",
      state: plan.message.state,
      key: plan.message.reminderKey,
      text: plan.message.text,
      messageId: null,
      status,
    };
  }
  return {
    action: "SENT",
    state: plan.message.state,
    key: plan.message.reminderKey,
    text: plan.message.text,
    messageId: sent.messageId ?? null,
    status,
  };
}

function describeOutcome(o: Outcome): string {
  return o.action === "SKIP" ? `SKIP:${o.reason}` : `${o.action}:${o.state}`;
}

// ── reset (isolated DB only) ───────────────────────────────────────────────
async function resetTestState() {
  const db = supabaseAdmin();
  const { data: rows } = await db
    .from("line_events")
    .select("id, extracted")
    .eq("direction", "out")
    .order("created_at", { ascending: false })
    .limit(500);
  const ids = (rows ?? [])
    .filter((r: Record<string, unknown>) => {
      const ex = r.extracted as Record<string, unknown> | null;
      return typeof ex?.reminder_key === "string" && String(ex.reminder_key).startsWith("c2200000-");
    })
    .map((r: Record<string, unknown>) => String(r.id));
  if (ids.length) await db.from("line_events").delete().in("id", ids);

  // race case: start with the payment un-allocated so the harness can inject it mid-flight
  await db
    .from("payment_allocations")
    .delete()
    .eq("receipt_document_id", "d2200000-0000-4000-8000-000000000009");
  await db
    .from("receipt_documents")
    .update({ allocation_state: "unallocated" })
    .eq("id", "d2200000-0000-4000-8000-000000000009");
}

// ── cases ───────────────────────────────────────────────────────────────────
async function main() {
  const now = new Date();
  // calendar-day evaluation instant (Bangkok), not a UTC-shifted midnight
  const asOf = new Date(`${businessDate(now)}T00:00:00Z`);
  await resetTestState();

  // 1) not due — outside the pre-due window
  {
    const r = await attemptReminder(COMPANIES.NOT_DUE, asOf);
    record("C1 not-due (due +30d)", "SKIP:NOT_IN_WINDOW", describeOutcome(r));
  }

  // 2) pre-due inside window → BEFORE_DUE
  {
    const r = await attemptReminder(COMPANIES.PRE_DUE, asOf);
    record("C2 pre-due (due +5d)", "SENT:BEFORE_DUE", describeOutcome(r), {
      hasDocNo: r.action === "SENT" ? r.text.includes("M022-INV-002") : false,
      hasAmount: r.action === "SENT" ? r.text.includes("20,000.00") : false,
      messageId: r.action === "SENT" ? r.messageId : null,
    });
  }

  // 3) due today → DUE_TODAY
  {
    const r = await attemptReminder(COMPANIES.DUE_TODAY, asOf);
    record("C3 due-today", "SENT:DUE_TODAY", describeOutcome(r));
  }

  // 4) overdue with partial payment → OVERDUE, canonical remaining balance
  {
    const debt = await readCompanyInvoiceDebt(COMPANIES.OVERDUE_PARTIAL);
    const r = await attemptReminder(COMPANIES.OVERDUE_PARTIAL, asOf);
    const inv = debt.invoices[0];
    record(
      "C4 overdue + partial payment",
      "SENT:OVERDUE|25000|5000",
      r.action === "SENT" ? `SENT:${r.state}|${inv.outstanding}|${inv.paid}` : describeOutcome(r),
      {
        receivable: inv.receivable,
        paid: inv.paid,
        outstanding: inv.outstanding,
        textHasRemaining: r.action === "SENT" ? r.text.includes("25,000.00") : false,
        companyLedger: debt.companyLedger,
        note: "company_debt_current ledger_outstanding ไม่มี debt_events สำหรับ receivable นี้",
      },
    );
  }

  // 5) fully paid → no reminder
  {
    const r = await attemptReminder(COMPANIES.PAID, asOf);
    record("C5 fully paid", "SKIP:NO_OUTSTANDING", describeOutcome(r));
  }

  // 6) no authorized recipient
  {
    const r = await attemptReminder(COMPANIES.NO_RECIPIENT, asOf);
    record(
      "C6 no authorized recipient",
      "SKIP:RECIPIENT_NO_LINK",
      describeOutcome(r),
    );
  }

  // 7) duplicate send (retry same day)
  {
    const first = await attemptReminder(COMPANIES.DUPLICATE, asOf);
    const second = await attemptReminder(COMPANIES.DUPLICATE, asOf);
    record(
      "C7 duplicate retry",
      "SENT:OVERDUE→SKIP:DUPLICATE_ALREADY_SENT",
      `${describeOutcome(first)}→${describeOutcome(second)}`,
    );
  }

  // 8) LINE API failure → FAILED recorded, no crash, no duplicate retry window lost
  {
    lineMode = "fail";
    const r = await attemptReminder(COMPANIES.LINE_FAILURE, asOf);
    lineMode = "ok";
    record(
      "C8 LINE API failure",
      "FAILED:OVERDUE",
      describeOutcome(r),
      { recordedStatus: r.action === "FAILED" ? r.status : null },
    );
  }

  // 8b) transient failure is retriable, but only once the transport recovers
  {
    const retry = await attemptReminder(COMPANIES.LINE_FAILURE, asOf);
    const again = await attemptReminder(COMPANIES.LINE_FAILURE, asOf);
    record(
      "C8b retry after LINE recovery",
      "SENT:OVERDUE→SKIP:DUPLICATE_ALREADY_SENT",
      `${describeOutcome(retry)}→${describeOutcome(again)}`,
    );
  }

  // 9) payment lands between prepare and send → suppressed
  {
    const r = await attemptReminder(COMPANIES.RACE, asOf, {
      beforeSend: async () => {
        // the real canonical payment writer, not a hand-written allocation row
        const paid = await confirmPayment({
          receipt_document_id: "d2200000-0000-4000-8000-000000000009",
          allocations: [
            {
              target: { kind: "invoice", id: "a2200000-0000-4000-8000-000000000009" },
              allocation_kind: "principal",
              amount: 22000,
              note: "M022 payment during prepare",
            },
          ],
          actor: "m022-race-test",
        });
        console.log("     payment confirmed mid-prepare:", JSON.stringify(paid.refreshed));
      },
    });
    record(
      "C9 payment during prepare",
      "SKIP:PAID_SINCE_PREPARE",
      describeOutcome(r),
    );
  }

  // 10) scheduler (pure) agreement with the composer window
  {
    const s1 = checkDebtSchedule(
      { id: "s-not-due", status: "OUTSTANDING", dueDate: new Date(Date.now() + 30 * 86400_000).toISOString(), gracePeriodHours: 24 },
      now,
    );
    const s2 = checkDebtSchedule(
      { id: "s-overdue", status: "OUTSTANDING", dueDate: new Date(Date.now() - 40 * 86400_000).toISOString(), gracePeriodHours: 24 },
      now,
    );
    record(
      "C10 scheduler due/overdue classification",
      "none→overdue_trigger",
      `${s1.action}→${s2.action}`,
    );
  }

  // ── safety + evidence checks ──
  const allCaptured = captured.length;
  const hostsOk = captured.every((c) => c.url.includes("api.line.me"));
  record("S1 no external network (all pushes intercepted)", "true", String(allCaptured > 0 && hostsOk), {
    interceptedCalls: allCaptured,
  });

  const db = supabaseAdmin();
  const { data: outRows } = await db
    .from("line_events")
    .select("status, line_message_id, extracted")
    .eq("direction", "out")
    .order("created_at", { ascending: false })
    .limit(50);
  const m022Rows = (outRows ?? []).filter((r: Record<string, unknown>) => {
    const ex = r.extracted as Record<string, unknown> | null;
    return typeof ex?.reminder_key === "string" && String(ex.reminder_key).includes("c2200000-0000-4000-8000-0000000000");
  });
  const statuses = m022Rows.map((r: Record<string, unknown>) => String(r.status));
  const sentCount = statuses.filter((s) => s === "sent").length;
  const failedCount = statuses.filter((s) => s === "failed").length;
  const queuedCount = statuses.filter((s) => s === "queued").length;
  record(
    "S2 delivery evidence persisted",
    "sent=5,failed=1,queued=0",
    `sent=${sentCount},failed=${failedCount},queued=${queuedCount}`,
    { rows: statuses },
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nM022 SUMMARY pass=${passed}/${results.length}`);
  console.log("M022_JSON " + JSON.stringify({ passed, total: results.length, results, interceptedCalls: allCaptured }));
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("M022 HARNESS ERROR:", e);
  process.exit(2);
});
