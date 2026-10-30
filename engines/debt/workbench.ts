/**
 * Debt reminder workbench — the read model behind the staging screen.
 *
 * It is deliberately a VIEW over existing authorities, not a second pipeline:
 *   • balances come from `readCompanyInvoiceDebt` (the exact reader the cron
 *     uses) and `company_debt_position` (invoice vs ledger, dedup-labelled),
 *   • recipients come from `selectDebtRecipient` (tenant/trust/role/consent),
 *   • wording comes from `planDebtReminder` (the only composer),
 *   • history is the existing `line_events` out rows.
 *
 * Safe preview send writes an audit row with status `preview`. That status is
 * outside the send-once index (`queued|sent|delivery_confirmed`), so a demo can
 * never block or impersonate a real reminder. It never calls LINE.
 */
import {
  readCompanyInvoiceDebt,
  selectDebtRecipient,
  businessDateIn,
  type InvoiceDebt,
} from "@/engines/debt/reminder-runner";
import { planDebtReminder, type ReminderState } from "@/engines/debt/reminder-message";

export type TrackingStatus = "CURRENT" | "DUE_SOON" | "OVERDUE" | "PAID" | "VOID";

export interface PreviewMessage {
  state: ReminderState;
  label: string;
  text: string;
}

export interface WorkbenchHistoryRow {
  id: string;
  at: string | null;
  companyId: string | null;
  documentNo: string | null;
  state: string | null;
  status: string;
  mode: "LIVE" | "PREVIEW";
  error: string | null;
  lineMessageId: string | null;
}

export interface WorkbenchRow {
  companyId: string;
  companyName: string;
  invoiceId: string;
  invoiceNo: string;
  receivable: number;
  paid: number;
  outstanding: number;
  dueDate: string;
  daysOverdue: number;
  trackingStatus: TrackingStatus;
  reconciliation: {
    invoiceOutstanding: number;
    ledgerOutstanding: number;
    linkedLedgerNet: number;
    positionOutstanding: number;
    status: string;
    duplicateSuppressed: boolean;
    snapshotMatchesLedger: boolean;
  } | null;
  recipient: {
    ok: boolean;
    lineUserId: string | null;
    role: string | null;
    trust: string | null;
    reason: string | null;
    consent: "ALLOWED" | "OPTED_OUT" | "NOT_CONFIGURED" | "UNKNOWN";
  };
  previews: PreviewMessage[];
  history: WorkbenchHistoryRow[];
}

export interface WorkbenchResult {
  previewMode: boolean;
  generatedAt: string;
  businessDate: string;
  summary: {
    companies: number;
    openInvoices: number;
    totalOutstanding: number;
    overdueInvoices: number;
    dueSoonInvoices: number;
    blockedRecipients: number;
  };
  companies: { id: string; name: string }[];
  rows: WorkbenchRow[];
  history: WorkbenchHistoryRow[];
}

const DAY = 86_400_000;
const STATE_LABEL: Record<ReminderState, string> = {
  BEFORE_DUE: "ก่อนครบกำหนด",
  DUE_TODAY: "ครบกำหนดวันนี้",
  OVERDUE: "เกินกำหนด",
};

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY);
}

function trackingStatusOf(debt: InvoiceDebt, businessDate: string): TrackingStatus {
  if (debt.derivedStatus === "VOID") return "VOID";
  if (debt.outstanding <= 0) return "PAID";
  const daysOverdue = daysBetween(debt.dueDate, businessDate);
  if (daysOverdue > 0) return "OVERDUE";
  if (daysOverdue >= -7) return "DUE_SOON";
  return "CURRENT";
}

function sampleAsOf(dueDate: string, state: ReminderState): Date {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const base = Number.isNaN(due) ? Date.now() : due;
  const offset = state === "BEFORE_DUE" ? -3 : state === "DUE_TODAY" ? 0 : 5;
  return new Date(base + offset * DAY);
}

function buildPreviews(debt: InvoiceDebt, creditorName: string, contactChannel: string): PreviewMessage[] {
  return (["BEFORE_DUE", "DUE_TODAY", "OVERDUE"] as ReminderState[]).map((state) => {
    const plan = planDebtReminder({
      creditorName,
      documentNo: debt.invoiceNo,
      dueDate: debt.dueDate,
      asOf: sampleAsOf(debt.dueDate, state),
      outstanding: debt.outstanding,
      contactChannel,
      windowDays: 7,
      reminderKey: `preview|${debt.invoiceId}|${state}`,
    });
    return {
      state,
      label: STATE_LABEL[state],
      text: plan.action === "SEND" ? plan.message.text : `(แสดงตัวอย่างไม่ได้: ${plan.reason})`,
    };
  });
}

export interface WorkbenchOptions {
  /** null = platform scope (no restriction) */
  companyIds: Set<string> | null;
  filterCompanyId?: string | null;
  creditorName: string;
  contactChannel: string;
  previewMode: boolean;
  now?: Date;
}

export async function buildDebtReminderWorkbench(db: any, options: WorkbenchOptions): Promise<WorkbenchResult> {
  const now = options.now ?? new Date();
  const businessDate = businessDateIn(now);
  const scopeIds = options.companyIds;

  if (scopeIds && options.filterCompanyId && !scopeIds.has(options.filterCompanyId)) {
    throw Object.assign(new Error("company outside the caller's scope"), { code: "OUT_OF_SCOPE" });
  }

  const targetIds = options.filterCompanyId
    ? [options.filterCompanyId]
    : scopeIds
      ? [...scopeIds]
      : null;

  const { data: companies, error: companiesErr } = targetIds
    ? targetIds.length
      ? await db.from("companies").select("id, name").in("id", targetIds)
      : { data: [], error: null }
    : await db.from("companies").select("id, name");
  if (companiesErr) throw new Error(`companies read failed: ${companiesErr.message}`);

  const companyList = ((companies ?? []) as { id: string; name: string }[]).map((c) => ({
    id: String(c.id),
    name: String(c.name ?? ""),
  }));

  const [{ data: positions }, { data: eventRows }] = await Promise.all([
    companyList.length
      ? db
          .from("company_debt_position")
          .select("company_id, invoice_outstanding, ledger_outstanding, ledger_invoice_linked_net, position_outstanding, reconciliation_status, duplicate_risk_suppressed, snapshot_matches_ledger")
          .in("company_id", companyList.map((c) => c.id))
      : Promise.resolve({ data: [] }),
    companyList.length
      ? db
          .from("line_events")
          .select("id, line_user_id, status, line_message_id, admin_note, extracted, created_at")
          .eq("direction", "out")
          .order("created_at", { ascending: false })
          .limit(400)
      : Promise.resolve({ data: [] }),
  ]);

  const positionByCompany = new Map(
    ((positions ?? []) as any[]).map((p) => [String(p.company_id), p]),
  );

  const history: WorkbenchHistoryRow[] = ((eventRows ?? []) as any[])
    .filter((r) => {
      const ex = r.extracted && typeof r.extracted === "object" ? r.extracted : {};
      return typeof ex.reminder_key === "string" && typeof ex.company_id === "string";
    })
    .map((r) => {
      const ex = r.extracted ?? {};
      return {
        id: String(r.id),
        at: r.created_at ? String(r.created_at) : null,
        companyId: String(ex.company_id),
        documentNo: typeof ex.document_no === "string" ? ex.document_no : null,
        state: typeof ex.reminder_state === "string" ? ex.reminder_state : null,
        status: String(r.status),
        mode: ex.mode === "PREVIEW" ? ("PREVIEW" as const) : ("LIVE" as const),
        error: r.admin_note ? String(r.admin_note) : null,
        lineMessageId: r.line_message_id ? String(r.line_message_id) : null,
      };
    })
    .filter((h) => companyList.some((c) => c.id === h.companyId));

  const rows: WorkbenchRow[] = [];
  for (const company of companyList) {
    const debts = await readCompanyInvoiceDebt(db, company.id);
    if (!debts.length) continue;

    const recipient = await selectDebtRecipient(db, company.id);
    const { data: profile } = recipient.ok
      ? await db
          .from("line_profiles")
          .select("permissions")
          .eq("line_user_id", recipient.lineUserId)
          .maybeSingle()
      : { data: null };
    const consentValue = (profile?.permissions as Record<string, unknown> | null | undefined)?.debt_reminder;
    const consent: WorkbenchRow["recipient"]["consent"] = !recipient.ok
      ? recipient.reason === "RECIPIENT_OPTED_OUT"
        ? "OPTED_OUT"
        : "UNKNOWN"
      : consentValue === false
        ? "OPTED_OUT"
        : consentValue === true
          ? "ALLOWED"
          : "NOT_CONFIGURED";

    const pos = positionByCompany.get(company.id);
    for (const debt of debts) {
      const daysOverdue = Math.max(0, daysBetween(debt.dueDate, businessDate));
      rows.push({
        companyId: company.id,
        companyName: company.name,
        invoiceId: debt.invoiceId,
        invoiceNo: debt.invoiceNo,
        receivable: debt.receivable,
        paid: debt.paid,
        outstanding: debt.outstanding,
        dueDate: debt.dueDate,
        daysOverdue,
        trackingStatus: trackingStatusOf(debt, businessDate),
        reconciliation: pos
          ? {
              invoiceOutstanding: Number(pos.invoice_outstanding ?? 0),
              ledgerOutstanding: Number(pos.ledger_outstanding ?? 0),
              linkedLedgerNet: Number(pos.ledger_invoice_linked_net ?? 0),
              positionOutstanding: Number(pos.position_outstanding ?? 0),
              status: String(pos.reconciliation_status ?? "NONE"),
              duplicateSuppressed: Boolean(pos.duplicate_risk_suppressed),
              snapshotMatchesLedger: Boolean(pos.snapshot_matches_ledger),
            }
          : null,
        recipient: {
          ok: recipient.ok,
          lineUserId: recipient.ok ? recipient.lineUserId : null,
          role: recipient.ok ? recipient.role : null,
          trust: recipient.ok ? recipient.trust : null,
          reason: recipient.ok ? null : recipient.reason,
          consent,
        },
        previews: debt.outstanding > 0 ? buildPreviews(debt, options.creditorName, options.contactChannel) : [],
        history: history.filter(
          (h) => h.companyId === company.id && (!h.documentNo || h.documentNo === debt.invoiceNo),
        ),
      });
    }
  }

  const open = rows.filter((r) => r.outstanding > 0 && r.trackingStatus !== "VOID");
  return {
    previewMode: options.previewMode,
    generatedAt: now.toISOString(),
    businessDate,
    summary: {
      companies: new Set(open.map((r) => r.companyId)).size,
      openInvoices: open.length,
      totalOutstanding: Math.round(open.reduce((s, r) => s + r.outstanding, 0) * 100) / 100,
      overdueInvoices: open.filter((r) => r.trackingStatus === "OVERDUE").length,
      dueSoonInvoices: open.filter((r) => r.trackingStatus === "DUE_SOON").length,
      blockedRecipients: new Set(open.filter((r) => !r.recipient.ok).map((r) => r.companyId)).size,
    },
    companies: companyList.sort((a, b) => a.name.localeCompare(b.name, "th")),
    rows: rows.sort((a, b) => b.daysOverdue - a.daysOverdue || a.companyName.localeCompare(b.companyName, "th")),
    history,
  };
}

export interface PreviewSendInput {
  companyId: string;
  invoiceId: string;
  state: ReminderState;
  creditorName: string;
  contactChannel: string;
  actor: string;
  now?: Date;
}

export interface PreviewSendResult {
  ok: boolean;
  preview: true;
  text: string;
  state: ReminderState;
  auditId: string;
  note: string;
}

export async function previewDebtReminder(
  db: any,
  input: PreviewSendInput,
): Promise<PreviewSendResult> {
  const now = input.now ?? new Date();
  const debts = await readCompanyInvoiceDebt(db, input.companyId);
  const debt = debts.find((d) => d.invoiceId === input.invoiceId);
  if (!debt) throw Object.assign(new Error("invoice not found for this company"), { code: "INVOICE_NOT_FOUND" });
  if (debt.outstanding <= 0) throw Object.assign(new Error("nothing outstanding"), { code: "NO_OUTSTANDING" });

  const recipient = await selectDebtRecipient(db, input.companyId);
  if (!recipient.ok) {
    throw Object.assign(new Error(`recipient blocked: ${recipient.reason}`), { code: "RECIPIENT_BLOCKED" });
  }

  const plan = planDebtReminder({
    creditorName: input.creditorName,
    documentNo: debt.invoiceNo,
    dueDate: debt.dueDate,
    asOf: sampleAsOf(debt.dueDate, input.state),
    outstanding: debt.outstanding,
    contactChannel: input.contactChannel,
    windowDays: 7,
    reminderKey: `preview|${input.companyId}|${debt.invoiceNo}|${input.state}|${businessDateIn(now)}`,
  });
  if (plan.action !== "SEND") {
    throw Object.assign(new Error(plan.reason), { code: "COMPOSE_REJECTED" });
  }

  const { data, error } = await db
    .from("line_events")
    .insert({
      line_user_id: recipient.lineUserId,
      raw_type: "text",
      raw_text: plan.message.text,
      status: "preview",
      direction: "out",
      extracted: {
        mode: "PREVIEW",
        preview: true,
        reminder_key: plan.message.reminderKey,
        reminder_state: plan.message.state,
        template: "m022-reminder/1",
        company_id: input.companyId,
        document_no: debt.invoiceNo,
        due_date: debt.dueDate,
        amount_read: debt.outstanding,
        outstanding_read_at: now.toISOString(),
        recipient_role: recipient.role,
        recipient_trust: recipient.trust,
        // no delivery channel was used — preview mode never contacts a provider
        channel: "preview",
        sent_semantics: "PREVIEW_ONLY",
        actor: input.actor,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(`preview audit write failed: ${error.message}`);

  return {
    ok: true,
    preview: true,
    text: plan.message.text,
    state: plan.message.state,
    auditId: String(data.id),
    note: "บันทึกเป็นหลักฐานแบบ PREVIEW เท่านั้น — ไม่ได้ส่งผ่าน LINE",
  };
}
