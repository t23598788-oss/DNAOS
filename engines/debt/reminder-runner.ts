/**
 * Debt Reminder Runner — the ONE orchestration for an automated reminder.
 *
 * Runs in both runtimes that already exist:
 *   • Node 24 / Next (acceptance harness, admin tooling)
 *   • Deno / Supabase Edge (`supabase/functions/debt-reminder-cron`)
 *
 * It was extracted instead of copied because the Edge cron already carried a
 * hand-copied debt send path; M023 removes that second implementation and the
 * decision logic lives here once.
 *
 * Authority boundaries this file respects:
 *   • money is READ from the canonical invoice projection only
 *     (`invoices` + `invoice_payment_summary`). Nothing here adds, rounds
 *     down, accrues interest or re-derives a balance.
 *   • sending goes through the injected `send` function — the caller's single
 *     existing LINE path (Node: registry/communication.sendLineMessage;
 *     Edge: the same connector-token bridge + Messaging API push).
 *   • the audit store is the existing `line_events` table (direction='out').
 *     No new table, no new ledger.
 *
 * `compose` is injected rather than imported because Deno requires explicit
 * file extensions on relative imports while the Node build uses extensionless
 * ones; the only implementation passed in by both callers is
 * `engines/debt/reminder-message.ts#planDebtReminder`.
 */

export type ReminderState = "BEFORE_DUE" | "DUE_TODAY" | "OVERDUE";

export interface ComposerInput {
  creditorName: string;
  debtorName?: string;
  documentNo: string;
  dueDate: string;
  asOf: Date;
  outstanding: number;
  contactChannel: string;
  windowDays?: number;
  reminderKey?: string;
}

export interface ComposerPlan {
  action: "SKIP" | "SEND";
  reason?: string;
  message?: {
    state: ReminderState;
    text: string;
    reminderKey: string;
    fields: Record<string, unknown>;
  };
}

export type Composer = (input: ComposerInput) => ComposerPlan;

export type SendResult = {
  ok: boolean;
  messageId?: string | null;
  error?: string;
};

export type Sender = (lineUserId: string, messages: unknown[]) => Promise<SendResult>;

export interface ReminderRunnerDeps {
  /** supabase-js shaped client (own or service role) — read/write via RLS as configured */
  db: any;
  send: Sender;
  compose: Composer;
  /** organization that is owed the money */
  creditorName: string;
  /** one allowed contact channel, e.g. "LINE OA @dnaos" */
  contactChannel: string;
  /** how many days before due date a pre-due reminder may go out */
  windowDays?: number;
  /** injected clock for deterministic tests */
  now?: Date;
  /** stable version string recorded with every message */
  templateVersion?: string;
  /**
   * Observability hook fired after the audit row is queued and before the
   * balance is re-read. Production callers leave it unset; the acceptance
   * harness uses it to commit a payment mid-flight.
   */
  beforeSend?: (context: {
    companyId: string;
    lineUserId: string;
    documentNo: string;
    reminderKey: string;
  }) => Promise<void>;
}

export type ReminderOutcome =
  | "SENT"
  | "FAILED"
  | "SKIPPED";

export type ReminderSkipReason =
  | "NO_INVOICE_DEBT"
  | "NO_RECIPIENT_LINK"
  | "NO_RECIPIENT_PROFILE"
  | "RECIPIENT_NOT_VERIFIED"
  | "RECIPIENT_ROLE_NOT_ALLOWED"
  | "RECIPIENT_COMPANY_MISMATCH"
  | "RECIPIENT_TENANT_UNBOUND"
  | "RECIPIENT_OPTED_OUT"
  | "NOT_IN_WINDOW"
  | "DUPLICATE_ALREADY_SENT"
  | "RETRY_LIMIT_REACHED"
  | "PAID_SINCE_PREPARE"
  | "BALANCE_CHANGED_SINCE_PREPARE"
  | "COMPOSE_REJECTED";

export interface ReminderRunResult {
  companyId: string;
  outcome: ReminderOutcome;
  /** present when outcome = SKIPPED */
  reason?: ReminderSkipReason | string;
  lineUserId?: string;
  documentNo?: string;
  state?: ReminderState;
  reminderKey?: string;
  messageId?: string | null;
  /** what the canonical reader returned at send time */
  outstanding?: number;
  auditStatus?: string;
}

const DEFAULT_TEMPLATE = "m022-reminder/1";
const DEFAULT_TZ = "Asia/Bangkok";

/**
 * Failed delivery attempts tolerated per reminder_key (i.e. per company,
 * document and business day). The statute allows one collection contact per
 * day; a transport outage must not turn into an unbounded retry loop every
 * 10 minutes. Three attempts, then the day is closed for that document.
 */
export const MAX_SEND_ATTEMPTS = 3;

/**
 * Roles that may receive their own company's debt figures. A supplier/driver/
 * external contact is a different party and must never see the debtor's
 * balance (mission 023 §4). `flagged` trust is excluded even if verified.
 */
export const DEBT_RECIPIENT_ROLES = [
  "customer",
  "owner",
  "manager",
  "accountant",
  "admin",
  "employee",
] as const;

export function businessDateIn(value: Date | string, timeZone = DEFAULT_TZ): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface InvoiceDebt {
  invoiceId: string;
  invoiceNo: string;
  dueDate: string;
  receivable: number;
  paid: number;
  outstanding: number;
  derivedStatus: string;
}

/**
 * The single reader for "what does this company still owe on invoices".
 * Exported (M026) so the staging workbench shows exactly the number the runner
 * would send — one reader, no second calculation.
 */
export async function readCompanyInvoiceDebt(db: any, companyId: string): Promise<InvoiceDebt[]> {
  const { data: invoices, error } = await db
    .from("invoices")
    .select("id, invoice_no, due_date")
    .eq("customer_company_id", companyId);
  if (error) throw new Error(`invoices read failed: ${error.message}`);
  const ids = (invoices ?? []).map((i: any) => String(i.id));
  if (!ids.length) return [];

  const { data: sums, error: sumErr } = await db
    .from("invoice_payment_summary")
    .select("invoice_id, invoice_no, receivable_amount, paid_amount, outstanding, derived_status")
    .in("invoice_id", ids);
  if (sumErr) throw new Error(`invoice_payment_summary read failed: ${sumErr.message}`);
  const byId = new Map((sums ?? []).map((s: any) => [String(s.invoice_id), s]));

  return (invoices ?? [])
    .map((i: any) => {
      const s: any = byId.get(String(i.id)) ?? {};
      return {
        invoiceId: String(i.id),
        invoiceNo: String(s.invoice_no ?? i.invoice_no),
        dueDate: businessDateIn(String(i.due_date ?? "")),
        receivable: Number(s.receivable_amount ?? 0),
        paid: Number(s.paid_amount ?? 0),
        outstanding: Number(s.outstanding ?? 0),
        derivedStatus: String(s.derived_status ?? "UNKNOWN"),
      };
    })
    .filter((i: InvoiceDebt) => i.derivedStatus !== "VOID")
    .sort((a: InvoiceDebt, b: InvoiceDebt) => a.dueDate.localeCompare(b.dueDate));
}

type Recipient =
  | { ok: true; lineUserId: string; role: string; trust: string }
  | { ok: false; reason: ReminderSkipReason };

/**
 * Who may receive this company's debt balance, checked before any figure is
 * read into a message:
 *   1. Identity/tenant — the contact is linked to THIS company
 *      (`company_line_links.company_id`) AND the identity projection binds it
 *      to the same company (`line_profiles.company_id`). An unbound profile is
 *      refused rather than assumed to belong to the billed company.
 *   2. Trust — `verified` only; `unverified` and `flagged` are both refused.
 *   3. Role — an allowlist of the debtor's own people. `supplier`, `driver`,
 *      `contractor`, `external` are other parties and never see the balance.
 *   4. Consent — `permissions.debt_reminder === false` is an explicit opt-out
 *      and always wins. An absent key is treated as not-opted-out (the notice
 *      is a factual account notice, not marketing); requiring an explicit
 *      opt-in for every contact is an owner policy decision, recorded as such.
 */
export async function selectDebtRecipient(db: any, companyId: string): Promise<Recipient> {
  const { data: links } = await db
    .from("company_line_links")
    .select("line_user_id, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  if (!links?.length) return { ok: false, reason: "NO_RECIPIENT_LINK" };

  let sawProfile = false;
  let sawCompanyMismatch = false;
  let sawTenantUnbound = false;
  let sawRoleBlocked = false;
  let sawUnverified = false;
  let sawOptedOut = false;

  for (const link of links) {
    const lineUserId = String(link.line_user_id ?? "");
    if (!lineUserId) continue;
    const { data: profile } = await db
      .from("line_profiles")
      .select("role, trust_level, company_id, permissions")
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    if (!profile) continue;
    sawProfile = true;

    if (!profile.company_id) {
      sawTenantUnbound = true;
      continue;
    }
    if (String(profile.company_id) !== companyId) {
      sawCompanyMismatch = true;
      continue;
    }
    if (String(profile.trust_level) !== "verified") {
      sawUnverified = true;
      continue;
    }
    if (!(DEBT_RECIPIENT_ROLES as readonly string[]).includes(String(profile.role))) {
      sawRoleBlocked = true;
      continue;
    }
    const permissions =
      profile.permissions && typeof profile.permissions === "object"
        ? (profile.permissions as Record<string, unknown>)
        : {};
    if (permissions.debt_reminder === false) {
      sawOptedOut = true;
      continue;
    }
    return {
      ok: true,
      lineUserId,
      role: String(profile.role),
      trust: String(profile.trust_level),
    };
  }

  if (sawOptedOut) return { ok: false, reason: "RECIPIENT_OPTED_OUT" };
  if (sawCompanyMismatch) return { ok: false, reason: "RECIPIENT_COMPANY_MISMATCH" };
  if (sawTenantUnbound) return { ok: false, reason: "RECIPIENT_TENANT_UNBOUND" };
  if (sawRoleBlocked) return { ok: false, reason: "RECIPIENT_ROLE_NOT_ALLOWED" };
  if (sawUnverified) return { ok: false, reason: "RECIPIENT_NOT_VERIFIED" };
  if (sawProfile) return { ok: false, reason: "RECIPIENT_NOT_VERIFIED" };
  return { ok: false, reason: "NO_RECIPIENT_PROFILE" };
}

const LIVE_SEND_STATUSES = ["queued", "sent", "delivery_confirmed"];

/**
 * `sent` means exactly one thing here: the provider ACCEPTED the push request
 * (HTTP 2xx + provider message id). It is not evidence of delivery, of display
 * or of reading, and nothing in this module may claim otherwise. A delivery
 * receipt from the provider is the only thing that could ever promote a row to
 * `delivery_confirmed`, and no such handler exists yet.
 */
const SENT_MEANS = "PROVIDER_ACCEPTED";

async function countFailedAttempts(db: any, reminderKey: string): Promise<number> {
  const { count, error } = await db
    .from("line_events")
    .select("id", { count: "exact", head: true })
    .eq("direction", "out")
    .eq("status", "failed")
    .filter("extracted->>reminder_key", "eq", reminderKey);
  if (error || count == null) return 0;
  return count;
}

async function findExistingSend(db: any, reminderKey: string) {
  // Targeted lookup on the JSON path — a bounded "recent rows" scan would miss
  // an older send once the table grows and would then duplicate a reminder.
  const { data, error } = await db
    .from("line_events")
    .select("id, status")
    .eq("direction", "out")
    .in("status", LIVE_SEND_STATUSES)
    .filter("extracted->>reminder_key", "eq", reminderKey)
    .limit(1);
  if (!error) return (data ?? [])[0] ?? null;

  // Fallback for PostgREST builds that reject JSON-path filters: bounded scan.
  const { data: rows } = await db
    .from("line_events")
    .select("id, status, extracted")
    .eq("direction", "out")
    .order("created_at", { ascending: false })
    .limit(200);
  return (rows ?? []).find((row: any) => {
    const ex = row.extracted && typeof row.extracted === "object" ? row.extracted : {};
    return ex.reminder_key === reminderKey && LIVE_SEND_STATUSES.includes(String(row.status));
  });
}

export async function runCompanyReminder(
  companyId: string,
  deps: ReminderRunnerDeps,
): Promise<ReminderRunResult> {
  const now = deps.now ?? new Date();
  const asOf = new Date(`${businessDateIn(now)}T00:00:00Z`);
  const templateVersion = deps.templateVersion ?? DEFAULT_TEMPLATE;

  const invoices = await readCompanyInvoiceDebt(deps.db, companyId);
  const target = invoices.find((i) => i.outstanding > 0);
  if (!target) return { companyId, outcome: "SKIPPED", reason: "NO_INVOICE_DEBT" };

  const recipient = await selectDebtRecipient(deps.db, companyId);
  if (!recipient.ok) return { companyId, outcome: "SKIPPED", reason: recipient.reason };

  const reminderKey = `${companyId}|${target.invoiceNo}|${businessDateIn(now)}`;
  const plan = deps.compose({
    creditorName: deps.creditorName,
    documentNo: target.invoiceNo,
    dueDate: target.dueDate,
    asOf,
    outstanding: target.outstanding,
    contactChannel: deps.contactChannel,
    windowDays: deps.windowDays,
    reminderKey,
  });
  if (plan.action !== "SEND" || !plan.message) {
    return { companyId, outcome: "SKIPPED", reason: plan.reason ?? "COMPOSE_REJECTED" };
  }

  const existing = await findExistingSend(deps.db, plan.message.reminderKey);
  if (existing) {
    return { companyId, outcome: "SKIPPED", reason: "DUPLICATE_ALREADY_SENT" };
  }

  const failedAttempts = await countFailedAttempts(deps.db, plan.message.reminderKey);
  if (failedAttempts >= MAX_SEND_ATTEMPTS) {
    return { companyId, outcome: "SKIPPED", reason: "RETRY_LIMIT_REACHED" };
  }

  // position snapshot for the audit row — read, never used to decide the amount
  const { data: position } = await deps.db
    .from("company_debt_position")
    .select("invoice_outstanding, ledger_outstanding, position_outstanding, reconciliation_status")
    .eq("company_id", companyId)
    .maybeSingle();

  const { data: queued, error: queueErr } = await deps.db
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
        template: templateVersion,
        company_id: companyId,
        document_no: target.invoiceNo,
        due_date: target.dueDate,
        amount_read: target.outstanding,
        outstanding_read_at: new Date().toISOString(),
        creditor: deps.creditorName,
        contact_channel: deps.contactChannel,
        recipient_role: recipient.role,
        recipient_trust: recipient.trust,
        channel: "line",
        reconciliation_status: position?.reconciliation_status ?? null,
        position_outstanding: position?.position_outstanding ?? null,
        attempt: failedAttempts + 1,
        sent_semantics: SENT_MEANS,
      },
    })
    .select("id")
    .single();
  if (queueErr) {
    // A concurrent invocation won the race for this reminder_key: the partial
    // unique index on (extracted->>reminder_key) is what makes that a hard stop
    // instead of a second push.
    if (queueErr.code === "23505" || /duplicate key/i.test(queueErr.message ?? "")) {
      return { companyId, outcome: "SKIPPED", reason: "DUPLICATE_ALREADY_SENT" };
    }
    throw new Error(`queue write failed: ${queueErr.message}`);
  }
  if (!queued) throw new Error("queue write failed: no row returned");

  if (deps.beforeSend) {
    await deps.beforeSend({
      companyId,
      lineUserId: recipient.lineUserId,
      documentNo: target.invoiceNo,
      reminderKey: plan.message.reminderKey,
    });
  }

  // Re-read the canonical balance immediately before the money figure leaves
  // the building. A payment committed while we were composing must suppress
  // the message, not arrive right after it.
  const fresh = await readCompanyInvoiceDebt(deps.db, companyId);
  const freshTarget = fresh.find((i) => i.invoiceId === target.invoiceId);
  const freshOutstanding = freshTarget ? round2(freshTarget.outstanding) : 0;
  const cancelReason =
    freshOutstanding <= 0
      ? "PAID_SINCE_PREPARE"
      : Math.abs(freshOutstanding - round2(target.outstanding)) > 0.001
        ? "BALANCE_CHANGED_SINCE_PREPARE"
        : null;

  if (cancelReason) {
    await deps.db
      .from("line_events")
      .update({ status: "cancelled", admin_note: cancelReason })
      .eq("id", queued.id);
    return {
      companyId,
      outcome: "SKIPPED",
      reason: cancelReason,
      documentNo: target.invoiceNo,
      lineUserId: recipient.lineUserId,
      outstanding: freshOutstanding,
      auditStatus: "cancelled",
    };
  }

  // A transport that throws (DNS, TLS, sandbox denial) must leave a FAILED
  // audit row, never a row stuck in 'queued' — the next run has to know it may
  // retry.
  let sent: SendResult;
  try {
    sent = await deps.send(recipient.lineUserId, [
      { type: "text", text: plan.message.text },
    ]);
  } catch (e) {
    sent = { ok: false, error: `SEND_THREW: ${e instanceof Error ? e.message : String(e)}` };
  }

  const status = sent.ok ? "sent" : "failed";
  await deps.db
    .from("line_events")
    .update({
      status,
      line_message_id: sent.ok ? (sent.messageId ?? null) : null,
      admin_note: sent.ok
        ? `provider accepted the request (${SENT_MEANS}); no delivery receipt exists`
        : (sent.error ?? "unknown error").slice(0, 500),
    })
    .eq("id", queued.id);

  return {
    companyId,
    outcome: sent.ok ? "SENT" : "FAILED",
    reason: sent.ok ? undefined : (sent.error ?? "SEND_FAILED"),
    lineUserId: recipient.lineUserId,
    documentNo: target.invoiceNo,
    state: plan.message.state,
    reminderKey: plan.message.reminderKey,
    messageId: sent.ok ? (sent.messageId ?? null) : null,
    outstanding: target.outstanding,
    auditStatus: status,
  };
}

export async function runDebtReminders(
  companyIds: string[] | null,
  deps: ReminderRunnerDeps,
): Promise<{ results: ReminderRunResult[]; summary: Record<string, number> }> {
  let ids = companyIds;
  if (!ids) {
    const { data, error } = await deps.db.from("invoices").select("customer_company_id");
    if (error) throw new Error(`company list read failed: ${error.message}`);
    ids = Array.from(
      new Set(
        (data ?? [])
          .map((r: any) => (r.customer_company_id ? String(r.customer_company_id) : ""))
          .filter(Boolean),
      ),
    ) as string[];
  }

  const results: ReminderRunResult[] = [];
  for (const id of ids) {
    try {
      results.push(await runCompanyReminder(id, deps));
    } catch (e) {
      results.push({
        companyId: id,
        outcome: "FAILED",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    const key = r.outcome === "SKIPPED" ? `SKIPPED:${r.reason}` : r.outcome;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return { results, summary };
}
