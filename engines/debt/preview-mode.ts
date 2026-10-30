/**
 * SAFE PREVIEW MODE — one flag, read by every debt-collection sender.
 *
 * A staging environment must be able to demonstrate the whole collection flow
 * without a single real LINE push. When this flag is on:
 *   • the debt-reminder cron refuses to run at all,
 *   • the manual "send debt card" route refuses before it builds anything,
 *   • the workbench only writes `preview` audit rows (never `queued`/`sent`),
 *   • nothing can occupy the send-once index, so turning the flag off leaves the
 *     real send path exactly as it was.
 *
 * It is intentionally read from the environment on every call (no cache), and it
 * fails OPEN only when explicitly absent: the default is "real mode" for
 * production, while staging sets `DEBT_REMINDER_PREVIEW_MODE=1`.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isDebtPreviewMode(env: Record<string, string | undefined> | undefined): boolean {
  const raw = env?.DEBT_REMINDER_PREVIEW_MODE;
  return typeof raw === "string" && TRUTHY.has(raw.trim().toLowerCase());
}
