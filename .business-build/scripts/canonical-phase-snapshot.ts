#!/usr/bin/env npx tsx
/**
 * Canonical model v1.1 — PRE-RUN SNAPSHOT (the missing phaseC-before.json stage).
 *
 * Engine/DB process gap fixed (read-only, zero writes, zero schema):
 *   canonical-phase-c/d-acceptance-test.ts both read "/tmp/phaseC-before.json"
 *   (row_counts + financial_totals) as the "before" baseline to prove nothing
 *   drifted — but NOTHING in the repo ever produced it, so both suites crashed
 *   with ENOENT at module load (pre-existing, see DNA- worktree census).
 *
 * What this file does:
 *   - captures the zip SNAPshots with EXACTLY the counts phase C §8 reads back
 *     (same 15 tables, same D10-ACCEPTANCE exclusions) and the same invoice
 *     totals phase C §7 compares ("reference_no.is.null or not like
 *     D10-ACCEPTANCE-%") — one source, no shadow query logic.
 *   - ensurePhaseCSnapshot() regenerates ONLY when the file is missing (e.g.
 *     /tmp was wiped) and prints that fact; an existing snapshot is NEVER
 *     overwritten by a test run (that would fake "no drift").
 *   - runnable standalone: npx tsx scripts/canonical-phase-snapshot.ts
 *
 * READ-ONLY: every access is count/select only. No migration, no deploy.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^[\"']|[\"']$/g, "");
    }
  } catch {
    /* env may already be provided by the shell */
  }
}
loadEnvLocal();

import { supabaseAdmin } from "@/services/supabase/queries";

const SNAP_PATH = "/tmp/phaseC-before.json";

/** The exact table list + exclusions phase C §8 (nothing-different check) reads back. */
const TABLES = [
  "companies", "customer_sites", "projects", "document_groups", "customer_orders", "invoices", "invoice_items",
  "standalone_documents", "standalone_document_items", "receipt_documents", "business_events", "debt_events",
  "debt_snapshots", "bank_statement_transactions", "audit_logs",
] as const;

/** Invoices excluded from the legacy count: the acceptance-harness documents (D10-ACCEPTANCE-%). */
const ACCEPTANCE_PREFIX = "D10-ACCEPTANCE-%";

export async function takePhaseCSnapshot(): Promise<string> {
  const db = supabaseAdmin();
  const exactCount = async (table: string): Promise<number> => {
    const { count } = await db.from(table).select("*", { count: "exact", head: true });
    return count ?? 0;
  };

  const row_counts: { t: string; n: number }[] = [];
  for (const table of TABLES) {
    if (table === "invoices") {
      // phase C §8's typed exclusion: legacy count = total - acceptance rows
      const { count: excluded } = await db.from(table).select("*", { count: "exact", head: true }).like("reference_no", ACCEPTANCE_PREFIX);
      row_counts.push({ t: table, n: (await exactCount(table)) - (excluded ?? 0) });
    } else if (table === "invoice_items") {
      // items belong to their invoice; the legacy count is what matters (phase C §8)
      const { data: acceptanceInvoices } = await db.from("invoices").select("id").like("reference_no", ACCEPTANCE_PREFIX);
      const { count: totalItems } = await db.from(table).select("*", { count: "exact", head: true });
      let acceptanceItems = 0;
      for (const r of (acceptanceInvoices ?? []) as Record<string, unknown>[]) {
        const { count } = await db.from(table).select("*", { count: "exact", head: true }).eq("invoice_id", String(r.id));
        acceptanceItems += count ?? 0;
      }
      row_counts.push({ t: table, n: (totalItems ?? 0) - acceptanceItems });
    } else {
      row_counts.push({ t: table, n: await exactCount(table) });
    }
  }

  // phase C §7's exact totals query (legacy rows only)
  const { data: fin, error } = await db
    .from("invoices")
    .select("subtotal, vat_amount, total_amount, paid_amount")
    .or("reference_no.is.null,reference_no.not.like.D10-ACCEPTANCE-%");
  if (error) throw new Error(`invoices totals snapshot: ${error.message}`);
  const sum = (pick: (r: Record<string, unknown>) => unknown) =>
    ((fin ?? []) as Record<string, unknown>[]).reduce((a, r) => a + Number(pick(r) ?? 0), 0).toFixed(2);

  const financial_totals = (fin ?? []).length
    ? [{
        t: "invoices",
        n: String((fin ?? []).length),
        sub: sum((r) => r.subtotal),
        vat: sum((r) => r.vat_amount),
        total: sum((r) => r.total_amount),
        paid: sum((r) => r.paid_amount),
      }]
    : [{ t: "invoices", n: "0", sub: "0.00", vat: "0.00", total: "0.00", paid: "0.00" }];

  const snapshot = JSON.stringify({ row_counts, financial_totals }, null, 2);
  writeFileSync(SNAP_PATH, snapshot, "utf8");
  return SNAP_PATH;
}

/** Read-or-rebuild: NEVER overwrite an existing baseline from a test run. */
export async function ensurePhaseCSnapshot(): Promise<{ path: string; regenerated: boolean }> {
  if (existsSync(SNAP_PATH)) return { path: SNAP_PATH, regenerated: false };
  await takePhaseCSnapshot();
  console.log(
    `  note: no baseline existed (${SNAP_PATH} absent — /tmp wiped or first run); ` +
    `captured a FRESH read-only snapshot now. Historical drift checks apply cleanly from this point on.`,
  );
  return { path: SNAP_PATH, regenerated: true };
}

/** Read the snapshot row shape for a table (typed, shared). */
export function snapshotCount(before: { row_counts: { t: string; n: number }[] }, table: string): number | undefined {
  return before.row_counts.find((r) => r.t === table)?.n;
}

const invokedDirectly = process.argv[1]?.endsWith("canonical-phase-snapshot.ts");
if (invokedDirectly) {
  takePhaseCSnapshot()
    .then((p) => {
      console.log(`snapshot captured → ${p} (read-only · no rows touched)`);
      process.exit(0);
    })
    .catch((e) => {
      console.error("SNAPSHOT ERROR:", e instanceof Error ? e.message : e);
      process.exit(2);
    });
}
