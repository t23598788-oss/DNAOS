/**
 * M023 — Automated debt reminder integration (isolated, synthetic, NO real LINE send)
 *
 * Exercises the SAME orchestration the Edge cron now calls
 * (`engines/debt/reminder-runner.ts`) with the REAL Node outbound gateway
 * (`registry/communication.sendLineMessage` → Connect Run gate → LINE push),
 * the REAL canonical reader (`invoice_payment_summary`), the REAL payment
 * writer (`confirmPayment`), and the REAL audit store (`line_events`).
 *
 * Only the network is faked: global fetch is intercepted, every push is
 * recorded, and nothing can leave the machine.
 *
 * Run:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54327 \
 *   SUPABASE_SERVICE_ROLE_KEY=dnaos-isolated-test-key \
 *   npx tsx scripts/m023-debt-reminder-integration-e2e.ts
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { sendLineMessage } from "@/registry/communication";
import { planDebtReminder } from "@/engines/debt/reminder-message";
import { runDebtReminders, type ReminderRunResult } from "@/engines/debt/reminder-runner";
import { confirmPayment } from "@/engines/canonical/payment-write";

const C = {
  UNVERIFIED: "c2300000-0000-4000-8000-00000000000a",
  SUPPLIER_ROLE: "c2300000-0000-4000-8000-00000000000b",
  NO_LINK: "c2300000-0000-4000-8000-00000000000c",
  MULTI_CONTACT: "c2300000-0000-4000-8000-00000000000d",
  NOT_IN_WINDOW: "c2300000-0000-4000-8000-00000000000e",
  RETRY: "c2300000-0000-4000-8000-00000000000f",
  RACE: "c2300000-0000-4000-8000-000000000011",
} as const;

const ALL = Object.values(C);
const CREDITOR = "M023 เจ้าหนี้ ทดสอบ (synthetic)";
const CONTACT = "LINE OA @m023-test";
const TOKEN = "M023-SYNTHETIC-NOT-A-REAL-TOKEN";

// ── network isolation ───────────────────────────────────────────────────────
type Captured = { url: string; to: string; body: string; auth: string };
const captured: Captured[] = [];
let lineMode: "ok" | "fail" = "ok";
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("api.line.me")) {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = String(init?.body ?? "");
    captured.push({
      url,
      to: JSON.parse(body || "{}").to,
      body,
      auth: headers.Authorization ?? headers.authorization ?? "",
    });
    if (lineMode === "fail") {
      return new Response("line: simulated outage", { status: 503 });
    }
    return new Response(
      JSON.stringify({ sentMessages: [{ id: `m023-mock-${captured.length}` }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return realFetch(input, init);
}) as typeof fetch;

// ── result helpers ──────────────────────────────────────────────────────────
const results: { name: string; expected: string; actual: string; pass: boolean }[] = [];

function record(name: string, expected: string, actual: string, detail?: unknown) {
  const pass = expected === actual;
  results.push({ name, expected, actual, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — expected=${expected} actual=${actual}`);
  if (detail !== undefined) console.log("     " + JSON.stringify(detail));
}

function describe(r: ReminderRunResult | undefined): string {
  if (!r) return "MISSING";
  return r.outcome === "SKIPPED" ? `SKIPPED:${r.reason}` : r.outcome;
}

function byCompany(run: ReminderRunResult[], id: string) {
  return run.find((r) => r.companyId === id);
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

async function resetState() {
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
      return typeof ex?.company_id === "string" && String(ex.company_id).startsWith("c2300000-");
    })
    .map((r: Record<string, unknown>) => String(r.id));
  if (ids.length) await db.from("line_events").delete().in("id", ids);

  const raceReceipt = "d2300000-0000-4000-8000-000000000011";
  await db.from("payment_allocations").delete().eq("receipt_document_id", raceReceipt);
  await db.from("receipt_documents").update({ allocation_state: "unallocated" }).eq("id", raceReceipt);
}

async function main() {
  const now = new Date();
  await resetState();

  // ── T1: one cron-style pass (race company is held back for T2/T3) ──
  const t1 = await runDebtReminders(
    ALL.filter((id) => id !== C.RACE && id !== C.RETRY),
    { ...deps(), now },
  );
  record("T1 unverified recipient blocked", "SKIPPED:RECIPIENT_NOT_VERIFIED", describe(byCompany(t1.results, C.UNVERIFIED)));
  record("T1 supplier role blocked", "SKIPPED:RECIPIENT_ROLE_NOT_ALLOWED", describe(byCompany(t1.results, C.SUPPLIER_ROLE)));
  record("T1 company without linked contact blocked", "SKIPPED:NO_RECIPIENT_LINK", describe(byCompany(t1.results, C.NO_LINK)));
  record("T1 not-in-window skipped", "SKIPPED:NOT_IN_WINDOW", describe(byCompany(t1.results, C.NOT_IN_WINDOW)));

  const d = byCompany(t1.results, C.MULTI_CONTACT);
  record(
    "T1 overdue reminder to authorized contact",
    "SENT:U_M023_D2:13000",
    `${d?.outcome}:${d?.lineUserId}:${d?.outstanding}`,
    { state: d?.state, documentNo: d?.documentNo, messageId: d?.messageId },
  );

  // ── T2: a transient provider failure is retriable exactly once ──
  lineMode = "fail";
  const fFail = await runDebtReminders([C.RETRY], { ...deps(), now });
  lineMode = "ok";
  record("T2 provider outage recorded as FAILED", "FAILED", describe(byCompany(fFail.results, C.RETRY)));

  const fRetry = await runDebtReminders([C.RETRY], { ...deps(), now });
  record("T2 retry after recovery sends once", "SENT", describe(byCompany(fRetry.results, C.RETRY)));

  const fAgain = await runDebtReminders([C.RETRY], { ...deps(), now });
  record("T2 second retry suppressed", "SKIPPED:DUPLICATE_ALREADY_SENT", describe(byCompany(fAgain.results, C.RETRY)));

  // ── T3: payment committed after queue, before push → message cancelled ──
  const before = captured.length;
  const t3 = await runDebtReminders([C.RACE], {
    ...deps(),
    now,
    beforeSend: async () => {
      await confirmPayment({
        receipt_document_id: "d2300000-0000-4000-8000-000000000011",
        allocations: [
          {
            target: { kind: "invoice", id: "a2300000-0000-4000-8000-000000000011" },
            allocation_kind: "principal",
            amount: 17000,
            note: "M023 payment during prepare",
          },
        ],
        actor: "m023-race-test",
      });
    },
  });
  record("T3 paid mid-flight suppresses send", "SKIPPED:PAID_SINCE_PREPARE", describe(byCompany(t3.results, C.RACE)));
  record("T3 no push after payment", "true", String(captured.length === before));

  // ── T4: full duplicate pass (cron runs every 10 minutes in reality) ──
  const beforeDup = captured.length;
  const t4 = await runDebtReminders(ALL, { ...deps(), now });
  const dupCount = t4.results.filter((r) => r.reason === "DUPLICATE_ALREADY_SENT").length;
  record("T4 repeat pass sends nothing new", "0|2", `${captured.length - beforeDup}|${dupCount}`);
  record("T4 paid invoice no longer a debt", "SKIPPED:NO_INVOICE_DEBT", describe(byCompany(t4.results, C.RACE)));

  // ── T5: audit evidence ──
  const db = supabaseAdmin();
  const { data: rows } = await db
    .from("line_events")
    .select("status, line_message_id, extracted")
    .eq("direction", "out")
    .order("created_at", { ascending: false })
    .limit(500);
  const m023 = (rows ?? []).filter((r: Record<string, unknown>) => {
    const ex = r.extracted as Record<string, unknown> | null;
    return typeof ex?.company_id === "string" && String(ex.company_id).startsWith("c2300000-");
  });

  const statuses = m023.map((r: Record<string, unknown>) => String(r.status));
  const sentRows = m023.filter((r: Record<string, unknown>) => String(r.status) === "sent");
  const sentKeys = sentRows.map((r: Record<string, unknown>) => String((r.extracted as any).reminder_key));
  const uniqueKeys = new Set(sentKeys);
  const allHaveEvidence = m023.every((r: Record<string, unknown>) => {
    const ex = r.extracted as any;
    return (
      typeof ex?.reminder_key === "string" &&
      typeof ex?.template === "string" &&
      ex?.amount_read != null &&
      typeof ex?.outstanding_read_at === "string" &&
      typeof ex?.recipient_role === "string" &&
      typeof ex?.recipient_trust === "string" &&
      typeof ex?.company_id === "string"
    );
  });
  const sentHaveProviderId = sentRows.every((r: Record<string, unknown>) => Boolean(r.line_message_id));

  record(
    "T5 audit statuses (sent/failed/cancelled)",
    "sent=2,failed=1,cancelled=1",
    `sent=${statuses.filter((s) => s === "sent").length},failed=${statuses.filter((s) => s === "failed").length},cancelled=${statuses.filter((s) => s === "cancelled").length}`,
  );
  record("T5 no duplicate sent keys", "true", String(sentKeys.length === uniqueKeys.size));
  record("T5 every row carries debt evidence", "true", String(allHaveEvidence));
  record("T5 every sent row has provider id", "true", String(sentHaveProviderId));

  // ── T6: canonical position view reconciles invoice vs ledger ──
  const { data: pos, error: posErr } = await db
    .from("company_debt_position")
    .select("invoice_outstanding, ledger_outstanding, position_outstanding, reconciliation_status, invoice_days_overdue")
    .eq("company_id", C.MULTI_CONTACT)
    .maybeSingle();
  if (posErr) console.log("     position view error:", posErr.message);
  record(
    "T6 position view shows invoice debt",
    "13000|0|13000|INVOICE_ONLY|9",
    `${Number(pos?.invoice_outstanding)}|${Number(pos?.ledger_outstanding)}|${Number(pos?.position_outstanding)}|${pos?.reconciliation_status}|${pos?.invoice_days_overdue}`,
  );

  // ── T7: transport + recipient isolation ──
  const authOk = captured.every((c) => c.auth === `Bearer ${TOKEN}`);
  const hostOk = captured.every((c) => c.url.includes("api.line.me"));
  record("T7 single LINE endpoint + connector token", "true", String(authOk && hostOk));

  const recipientCompany: Record<string, string> = {
    U_M023_D1: C.MULTI_CONTACT,
    U_M023_D2: C.MULTI_CONTACT,
    U_M023_F1: C.RETRY,
    U_M023_G1: C.RACE,
    U_M023_A1: C.UNVERIFIED,
    U_M023_B1: C.SUPPLIER_ROLE,
    U_M023_E1: C.NOT_IN_WINDOW,
  };
  const tos = Array.from(new Set(captured.map((c) => c.to)));
  record(
    "T7 only authorized contacts were pushed",
    "U_M023_D2,U_M023_F1",
    tos.sort().join(","),
    { recipientCompanyResolved: tos.map((t) => recipientCompany[t]) },
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nM023 SUMMARY pass=${passed}/${results.length}`);
  console.log(
    "M023_JSON " +
      JSON.stringify({ passed, total: results.length, results, pushes: captured.length }),
  );
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("M023 HARNESS ERROR:", e);
  process.exit(2);
});
