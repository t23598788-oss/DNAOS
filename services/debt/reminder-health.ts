/**
 * Debt reminder delivery health — READ ONLY.
 *
 * This is not a second audit store: it reads the existing `line_events` out rows
 * that every reminder already writes (queued → sent | failed | cancelled).
 *
 * It exists because `sent` means only "the provider accepted the request". There
 * is no delivery/read receipt in the system, so the honest questions an operator
 * can ask are:
 *   • how many messages did the provider accept?
 *   • how many failed, and why?
 *   • is any row stuck in `queued` (the process died between queue and update)?
 * A stuck row matters: the unique send-once index keeps it live, so that
 * reminder can never be re-sent until it is resolved.
 */

export type ReminderRowStatus = "queued" | "sent" | "failed" | "cancelled" | string;

export interface ReminderFailure {
  id: string;
  lineUserId: string | null;
  companyId: string | null;
  documentNo: string | null;
  reminderKey: string | null;
  attempt: number | null;
  error: string | null;
  createdAt: string | null;
}

export interface ReminderHealth {
  windowHours: number;
  sent: number;
  failed: number;
  cancelled: number;
  queued: number;
  stuckQueued: number;
  /** the only delivery claim this system can make */
  deliveryConfirmed: 0;
  sentMeans: "PROVIDER_ACCEPTED";
  failures: ReminderFailure[];
  stuck: ReminderFailure[];
}

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_STUCK_MINUTES = 15;
const MAX_ROWS = 500;

function toFailure(row: Record<string, any>): ReminderFailure {
  const ex = row.extracted && typeof row.extracted === "object" ? row.extracted : {};
  return {
    id: String(row.id),
    lineUserId: row.line_user_id ? String(row.line_user_id) : null,
    companyId: typeof ex.company_id === "string" ? ex.company_id : null,
    documentNo: typeof ex.document_no === "string" ? ex.document_no : null,
    reminderKey: typeof ex.reminder_key === "string" ? ex.reminder_key : null,
    attempt: typeof ex.attempt === "number" ? ex.attempt : null,
    error: row.admin_note ? String(row.admin_note) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
  };
}

export async function getDebtReminderHealth(
  db: any,
  options: { windowHours?: number; stuckMinutes?: number; now?: Date } = {},
): Promise<ReminderHealth> {
  const windowHours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
  const stuckMinutes = options.stuckMinutes ?? DEFAULT_STUCK_MINUTES;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - windowHours * 3600_000).toISOString();
  const stuckBefore = new Date(now.getTime() - stuckMinutes * 60_000).toISOString();

  const { data, error } = await db
    .from("line_events")
    .select("id, line_user_id, status, admin_note, extracted, created_at")
    .eq("direction", "out")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw new Error(`debt reminder health read failed: ${error.message}`);

  const rows = ((data ?? []) as Record<string, any>[]).filter((r) => {
    const ex = r.extracted && typeof r.extracted === "object" ? r.extracted : {};
    return typeof ex.reminder_key === "string" && ex.reminder_key.length > 0;
  });

  const failures = rows.filter((r) => r.status === "failed").map(toFailure);

  // Stuck rows are queried on their own: a crashed invocation may be older than
  // the summary window and must still be visible, otherwise a reminder that can
  // never be retried (the send-once index keeps its key live) disappears.
  const { data: queuedRows, error: queuedErr } = await db
    .from("line_events")
    .select("id, line_user_id, status, admin_note, extracted, created_at")
    .eq("direction", "out")
    .eq("status", "queued")
    .lt("created_at", stuckBefore)
    .order("created_at", { ascending: true })
    .limit(MAX_ROWS);
  if (queuedErr) throw new Error(`debt reminder stuck-queue read failed: ${queuedErr.message}`);

  const stuck = ((queuedRows ?? []) as Record<string, any>[])
    .filter((r) => {
      const ex = r.extracted && typeof r.extracted === "object" ? r.extracted : {};
      return typeof ex.reminder_key === "string" && ex.reminder_key.length > 0;
    })
    .map(toFailure);

  return {
    windowHours,
    sent: rows.filter((r) => r.status === "sent").length,
    failed: failures.length,
    cancelled: rows.filter((r) => r.status === "cancelled").length,
    queued: rows.filter((r) => r.status === "queued").length,
    stuckQueued: stuck.length,
    deliveryConfirmed: 0,
    sentMeans: "PROVIDER_ACCEPTED",
    failures,
    stuck,
  };
}
