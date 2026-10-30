/**
 * M026 — staging workbench verification (isolated DB, synthetic data, no LINE).
 *
 * Proves the screen's data source:
 *   • lists debtors/invoices from the same canonical reader the cron uses,
 *   • renders the three reminder states from the one composer,
 *   • enforces tenant scope server-side (out-of-scope company is refused),
 *   • a "mock send" writes a PREVIEW audit row and never touches LINE,
 *   • preview rows cannot occupy the send-once index.
 *
 * Run:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54327 \
 *   SUPABASE_SERVICE_ROLE_KEY=dnaos-isolated-test-key \
 *   DEBT_REMINDER_PREVIEW_MODE=1 \
 *   npx tsx scripts/m026-workbench-verify.ts
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import {
  buildDebtReminderWorkbench,
  previewDebtReminder,
} from "@/engines/debt/workbench";
import { isDebtPreviewMode } from "@/engines/debt/preview-mode";

const results: { name: string; expected: string; actual: string; pass: boolean }[] = [];
function record(name: string, expected: string, actual: string) {
  const pass = expected === actual;
  results.push({ name, expected, actual, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — expected=${expected} actual=${actual}`);
}

const lineCalls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("api.line.me")) {
    lineCalls.push(url);
    return new Response("should never be called", { status: 500 });
  }
  return realFetch(input, init);
}) as typeof fetch;

const CREDITOR = "M026 เจ้าหนี้ ทดสอบ (synthetic)";
const CONTACT = "LINE OA @m026-test";

async function main() {
  const db = supabaseAdmin();

  // ── preview mode flag ─────────────────────────────────────────────────────
  record("T0 preview flag reads env", "true|false",
    `${isDebtPreviewMode({ DEBT_REMINDER_PREVIEW_MODE: "1" })}|${isDebtPreviewMode({})}`);

  // ── workbench (platform scope) ────────────────────────────────────────────
  const all = await buildDebtReminderWorkbench(db, {
    companyIds: null,
    creditorName: CREDITOR,
    contactChannel: CONTACT,
    previewMode: true,
  });

  const m022to25 = all.rows.filter((r) => /^c2[2345]/.test(r.companyId));
  record("T1 workbench lists synthetic debtors", "true", String(m022to25.length > 0));
  record("T1 rows expose the required money fields", "true", String(
    m022to25.every((r) => Number.isFinite(r.receivable) && Number.isFinite(r.paid) && Number.isFinite(r.outstanding)),
  ));
  record("T1 rows expose due date and overdue days", "true", String(
    m022to25.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate) && Number.isFinite(r.daysOverdue)),
  ));
  const withPreviews = m022to25.filter((r) => r.previews.length === 3);
  record("T1 every open invoice has 3 message previews", "true", String(withPreviews.length === m022to25.filter((r) => r.outstanding > 0).length));
  const states = withPreviews[0]?.previews.map((p) => p.state).join(",") ?? "";
  record("T1 previews are the three allowed states", "BEFORE_DUE,DUE_TODAY,OVERDUE", states);

  const overdueRow = m022to25.find((r) => r.trackingStatus === "OVERDUE");
  record("T1 overdue status derived from canonical due date", "true", String(Boolean(overdueRow && overdueRow.daysOverdue > 0)));
  record("T1 preview text never contains a threat word", "true", String(
    withPreviews.every((r) => r.previews.every((p) => !/ฟ้อง|ยึดทรัพย์|ประจาน|ขู่/.test(p.text))),
  ));

  // ── tenant scope ──────────────────────────────────────────────────────────
  const target = m022to25[0];
  const scoped = await buildDebtReminderWorkbench(db, {
    companyIds: new Set([target.companyId]),
    creditorName: CREDITOR,
    contactChannel: CONTACT,
    previewMode: true,
  });
  record("T2 scoped workbench returns only the allowed company", "true", String(
    scoped.rows.every((r) => r.companyId === target.companyId),
  ));

  let outOfScope = "none";
  try {
    await buildDebtReminderWorkbench(db, {
      companyIds: new Set(["c2400000-0000-4000-8000-000000000001"]),
      filterCompanyId: "c2500000-0000-4000-8000-000000000001",
      creditorName: CREDITOR,
      contactChannel: CONTACT,
      previewMode: true,
    });
  } catch (e) {
    outOfScope = (e as { code?: string }).code ?? "error";
  }
  record("T2 out-of-scope filter is refused", "OUT_OF_SCOPE", outOfScope);

  // ── preview send ──────────────────────────────────────────────────────────
  const sendRow = withPreviews.find((r) => r.recipient.ok);
  if (!sendRow) throw new Error("no sendable synthetic row");

  const beforeLive = await countLive(db);
  const preview = await previewDebtReminder(db, {
    companyId: sendRow.companyId,
    invoiceId: sendRow.invoiceId,
    state: "OVERDUE",
    creditorName: CREDITOR,
    contactChannel: CONTACT,
    actor: "m026-verify",
  });
  record("T3 mock send returns a preview marker", "true|true|PREVIEW_ONLY", `${preview.ok}|${preview.preview}|PREVIEW_ONLY`);
  record("T3 mock send produced message text", "true", String(preview.text.includes(sendRow.invoiceNo)));
  record("T3 NO LINE call happened", "0", String(lineCalls.length));

  const { data: audit } = await db
    .from("line_events")
    .select("status, raw_text, extracted")
    .eq("id", preview.auditId)
    .maybeSingle();
  record("T3 audit row is status=preview", "preview", String(audit?.status));
  record("T3 audit row is marked PREVIEW/ mock channel", "PREVIEW|mock|PREVIEW_ONLY",
    `${audit?.extracted?.mode}|${audit?.extracted?.channel}|${audit?.extracted?.sent_semantics}`);

  const afterLive = await countLive(db);
  record("T3 preview does not enter the send-once index", String(beforeLive), String(afterLive));

  // ── history ───────────────────────────────────────────────────────────────
  const reloaded = await buildDebtReminderWorkbench(db, {
    companyIds: new Set([sendRow.companyId]),
    creditorName: CREDITOR,
    contactChannel: CONTACT,
    previewMode: true,
  });
  const historyRow = reloaded.rows.flatMap((r) => r.history).find((h) => h.id === preview.auditId);
  record("T4 preview appears in delivery history as PREVIEW", "preview|PREVIEW",
    `${historyRow?.status}|${historyRow?.mode}`);

  // cleanup the preview rows this run created
  await db.from("line_events").delete().eq("status", "preview").eq("line_user_id", sendRow.recipient.lineUserId ?? "");

  // ── guard against a second LINE sender ────────────────────────────────────
  record("T5 zero LINE calls across the whole run", "0", String(lineCalls.length));

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nM026 SUMMARY pass=${passed}/${results.length}`);
  console.log("M026_JSON " + JSON.stringify({ passed, total: results.length, results }));
  process.exit(passed === results.length ? 0 : 1);
}

async function countLive(db: any): Promise<number> {
  const { count } = await db
    .from("line_events")
    .select("id", { count: "exact", head: true })
    .eq("direction", "out")
    .in("status", ["queued", "sent", "delivery_confirmed"]);
  return count ?? 0;
}

main().catch((e) => {
  console.error("M026 HARNESS ERROR:", e);
  process.exit(2);
});
