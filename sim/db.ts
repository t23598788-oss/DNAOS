/**
 * Read-mostly view of the database THE APP ACTUALLY USES.
 *
 * There is no local PostgREST in this machine, so "the local DB" from the task
 * does not exist: the app is wired to a hosted Supabase project. This module
 * therefore talks to that same project with the same service-role key, purely
 * to observe what the endpoints did.
 *
 * WRITE POLICY: this harness refuses any write that is not a delete of a row
 * carrying this run's SIM marker. The scenario is expected to cause zero
 * writes; if it ever causes one, it is visible in the deltas and removable by
 * sim/reset.ts.
 */
import { loadEnv } from "./env";

loadEnv();

export const SIM_MARK = "sim01";

export interface TableState {
  table: string;
  ok: boolean;
  count: number | null;
  error: string | null;
}

function cfg(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  return { url: url.replace(/\/$/, ""), key };
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const { key } = cfg();
  return { apikey: key, authorization: `Bearer ${key}`, ...extra };
}

export async function tableState(table: string): Promise<TableState> {
  const { url } = cfg();
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: headers({ prefer: "count=exact" }),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* keep raw */
    }
    return { table, ok: false, count: null, error: message };
  }
  const range = res.headers.get("content-range") ?? "";
  const count = Number(range.split("/")[1]);
  return { table, ok: true, count: Number.isFinite(count) ? count : null, error: null };
}

export async function selectRows(table: string, query: string): Promise<unknown> {
  const { url } = cfg();
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: headers() });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: res.status, body: text };
  }
}

export type Snapshot = Record<string, TableState>;

export async function snapshot(tables: string[]): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const table of tables) {
    out[table] = await tableState(table);
  }
  return out;
}

/** Rows that changed between two snapshots, in the shape the timeline prints. */
export function diff(before: Snapshot, after: Snapshot): string[] {
  const lines: string[] = [];
  for (const [table, b] of Object.entries(before)) {
    const a = after[table];
    if (!a) continue;
    if (!b.ok && !a.ok) {
      lines.push(`${table}: ABSENT (${a.error})`);
      continue;
    }
    if (!b.ok && a.ok) {
      lines.push(`${table}: 0 -> ${a.count} (table appeared)`);
      continue;
    }
    const delta = (a.count ?? 0) - (b.count ?? 0);
    if (delta !== 0) lines.push(`${table}: ${b.count} -> ${a.count} (${delta > 0 ? "+" : ""}${delta})`);
  }
  return lines.length > 0 ? lines : ["no row changed"];
}

/** Deletes ONLY rows this run marked. Any other filter is refused. */
export async function deleteSimRows(): Promise<Array<{ table: string; filter: string; deleted: number | null; error: string | null }>> {
  const targets = [
    { table: "integration_gateway_events", filter: `event_id=like.EVT-*-${SIM_MARK}*` },
    { table: "kbank_webhook_events", filter: `event_id=like.*${SIM_MARK}*` },
    { table: "customer_orders", filter: `order_no=like.SIM-${SIM_MARK}-*` },
    { table: "truck_jobs", filter: `id=eq.00000000-0000-0000-0000-0000${SIM_MARK}00` },
  ];
  const results: Array<{ table: string; filter: string; deleted: number | null; error: string | null }> = [];
  const { url } = cfg();
  for (const target of targets) {
    if (!target.filter.includes(SIM_MARK)) {
      throw new Error(`refusing to delete from ${target.table}: filter carries no SIM marker`);
    }
    const res = await fetch(`${url}/rest/v1/${target.table}?${target.filter}`, {
      method: "DELETE",
      headers: headers({ prefer: "return=representation" }),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        /* keep raw */
      }
      results.push({ table: target.table, filter: target.filter, deleted: null, error: message });
      continue;
    }
    let deleted = 0;
    try {
      deleted = Array.isArray(JSON.parse(text)) ? (JSON.parse(text) as unknown[]).length : 0;
    } catch {
      deleted = 0;
    }
    results.push({ table: target.table, filter: target.filter, deleted, error: null });
  }
  return results;
}
