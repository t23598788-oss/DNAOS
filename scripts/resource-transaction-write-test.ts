/**
 * Resource-transaction canonical path test (BATCH 20 — offline, no DB).
 *
 * Covers: valid write · duplicate idempotency · missing config · invalid job
 * · invalid duration · future started_at · bad/missing webhook token ·
 * sender not allowlisted · edge function has NO direct insert ·
 * internal route is the ONLY caller of the canonical writer.
 */
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { recordResourceTransaction, type ResourceTransactionInput, type ResourceTransactionDeps } from "@/engines/canonical/resource-transaction-write";
import { verifyKisWebhook, buildKisSourceEventId, type KisEmailPayload } from "../supabase/functions/_shared/kis-inbound-core";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (ok) { console.log(`PASS  ${name}`); return; }
  failures += 1;
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}
async function expectError(name: string, fn: () => Promise<unknown>, needle: string): Promise<void> {
  try {
    await fn();
    check(name, false, "no error thrown");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(name, msg.includes(needle), msg.slice(0, 140));
  }
}

// ── in-memory fake db (implements ResourceTransactionDeps["db"]) ────────────
function makeFakeDb(opts: {
  jobs: string[];
  configs: Record<string, unknown>;
  existingRows?: Record<string, unknown>[];
  forceInsertError?: string;
}): { db: ResourceTransactionDeps["db"]; inserted: Record<string, unknown>[] } {
  const inserted: Record<string, unknown>[] = [];
  const rows = [...(opts.existingRows ?? [])];
  const db = {
    from(table: string) {
      return {
        select(_columns?: string) {
          return {
            eq(column: string, value: string) {
              return {
                async maybeSingle() {
                  if (table === "jobs") {
                    return { data: opts.jobs.includes(value) ? { id: value } : null, error: null };
                  }
                  return { data: rows.find((r) => r[column] === value) ?? null, error: null };
                },
                async limit(_n: number) {
                  if (table === "app_configs") {
                    const data = value in opts.configs ? [{ title: value, data: opts.configs[value] }] : [];
                    return { data, error: null };
                  }
                  return { data: rows.filter((r) => r[column] === value), error: null };
                },
              };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          return {
            select(_c?: string) {
              return {
                async single() {
                  if (opts.forceInsertError) return { data: null, error: { message: opts.forceInsertError } };
                  const id = `rt-${inserted.length + 1}`;
                  const stored = { ...row, id };
                  inserted.push(stored);
                  rows.push(stored);
                  return { data: { id }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as ResourceTransactionDeps["db"], inserted };
}

function makeDeps(db: ResourceTransactionDeps["db"]) {
  const audits: unknown[] = [];
  const deps: ResourceTransactionDeps = {
    db,
    audit: (async (input: Parameters<ResourceTransactionDeps["audit"]>[0]) => {
      audits.push(input);
      return {} as Awaited<ReturnType<ResourceTransactionDeps["audit"]>>;
    }) as ResourceTransactionDeps["audit"],
    nowIso: () => "2026-10-08T12:00:00.000Z",
  };
  return { deps, audits };
}

const BASE: ResourceTransactionInput = {
  source: "kis_email",
  source_event_id: "kis-sha:test-001",
  resource_id: null,
  resource_label: "Kubota Excavator",
  job_id: "job-real-1",
  started_at: "2026-10-08T01:00:00.000Z",
  duration_hours: 3.5,
  evidence_ref: "sha256:evidence-001",
  received_at: "2026-10-08T02:00:00.000Z",
  actor: "test:resource-transaction",
};
const CONFIGS = { "fuel-price": "37.19", machinery_rates: JSON.stringify({ base_rate_per_hour: 600, fuel_consumption_lph: 8.5, markup_margin: 0.25 }) };

async function main() {
  // 1 — valid write (money computed ONLY from config authorities)
  {
    const { db, inserted } = makeFakeDb({ jobs: ["job-real-1"], configs: CONFIGS });
    const { deps, audits } = makeDeps(db);
    const result = await recordResourceTransaction(BASE, deps);
    check("valid write returns row", !result.duplicate && result.resource_transaction_id.length > 0);
    const expectedUnitCost = Math.round((600 + 8.5 * 37.19) * 100) / 100;
    check("unit_cost from authority (600 + 8.5*37.19)", result.unit_cost === expectedUnitCost, `got ${result.unit_cost} want ${expectedUnitCost}`);
    check("gross_cost = duration * unit_cost", result.gross_cost === Math.round(3.5 * expectedUnitCost * 100) / 100);
    check("fuel_price_reference = 37.19 (authority)", result.fuel_price_reference === 37.19);
    check("exactly one insert", inserted.length === 1, `inserted=${inserted.length}`);
    check("row carries source_event_id", inserted[0]?.source_event_id === "kis-sha:test-001");
    check("audit recorded", audits.length === 1);
  }

  // 2 — duplicate idempotency: same source_event_id = existing row, no 2nd insert
  {
    const { db, inserted } = makeFakeDb({ jobs: ["job-real-1"], configs: CONFIGS });
    const { deps } = makeDeps(db);
    const first = await recordResourceTransaction(BASE, deps);
    const second = await recordResourceTransaction(BASE, deps);
    check("duplicate returns same row", second.resource_transaction_id === first.resource_transaction_id);
    check("duplicate flagged", second.duplicate === true);
    check("no second insert", inserted.length === 1, `inserted=${inserted.length}`);
  }

  // 3 — missing config => fail-closed, zero writes (no 600/35 fallback)
  {
    const { db, inserted } = makeFakeDb({ jobs: ["job-real-1"], configs: { "fuel-price": "37.19" } });
    const { deps } = makeDeps(db);
    await expectError("missing machinery_rates => CONFIG_AUTHORITY_MISSING", () => recordResourceTransaction(BASE, deps), "CONFIG_AUTHORITY_MISSING");
    check("missing config writes nothing", inserted.length === 0);
  }
  {
    const { db, inserted } = makeFakeDb({ jobs: ["job-real-1"], configs: {} });
    const { deps } = makeDeps(db);
    await expectError("missing fuel-price => CONFIG_AUTHORITY_MISSING", () => recordResourceTransaction(BASE, deps), "CONFIG_AUTHORITY_MISSING");
    check("missing fuel-price writes nothing", inserted.length === 0);
  }

  // 4 — invalid job_id => reject, zero writes
  {
    const { db, inserted } = makeFakeDb({ jobs: ["job-other"], configs: CONFIGS });
    const { deps } = makeDeps(db);
    await expectError("invalid job => JOB_NOT_FOUND", () => recordResourceTransaction({ ...BASE, job_id: "job-missing" }, deps), "RESOURCE_TRANSACTION_JOB_NOT_FOUND");
    check("invalid job writes nothing", inserted.length === 0);
  }

  // 5 — invalid duration (0 / negative / NaN) => reject
  {
    const { db } = makeFakeDb({ jobs: ["job-real-1"], configs: CONFIGS });
    const { deps } = makeDeps(db);
    await expectError("duration 0 => INVALID_DURATION", () => recordResourceTransaction({ ...BASE, duration_hours: 0 }, deps), "RESOURCE_TRANSACTION_INVALID_DURATION");
    await expectError("duration -2 => INVALID_DURATION", () => recordResourceTransaction({ ...BASE, duration_hours: -2 }, deps), "RESOURCE_TRANSACTION_INVALID_DURATION");
    await expectError("duration NaN => INVALID_DURATION", () => recordResourceTransaction({ ...BASE, duration_hours: Number.NaN }, deps), "RESOURCE_TRANSACTION_INVALID_DURATION");
  }

  // 6 — future started_at (> received_at) => reject
  {
    const { db, inserted } = makeFakeDb({ jobs: ["job-real-1"], configs: CONFIGS });
    const { deps } = makeDeps(db);
    await expectError("started_at > received_at => INVALID_TIME", () => recordResourceTransaction({ ...BASE, started_at: "2026-10-08T03:00:00.000Z" }, deps), "RESOURCE_TRANSACTION_INVALID_TIME");
    check("future started_at writes nothing", inserted.length === 0);
  }

  // 7 — webhook token: missing / bad / valid (fail-closed)
  {
    const url = new URL("http://x/functions/v1/kis-webhook?token=right-token");
    const payload: KisEmailPayload = { from: '<kis@example.com>', envelope: { sender: "kis@example.com" }, subject: "s" };
    const cfg = { token: "right-token", senderAllowlist: "kis@example.com" };
    check("valid token+sender => ok", verifyKisWebhook(url, payload, cfg).ok === true);
    const noToken = verifyKisWebhook(new URL("http://x/functions/v1/kis-webhook"), payload, cfg);
    check("missing token => rejected", noToken.ok === false && noToken.reason.includes("token mismatch"), JSON.stringify(noToken));
    const badToken = verifyKisWebhook(new URL("http://x/functions/v1/kis-webhook?token=wrong"), payload, cfg);
    check("bad token => rejected", badToken.ok === false, JSON.stringify(badToken));
    const noConfig = verifyKisWebhook(url, payload, { token: undefined, senderAllowlist: cfg.senderAllowlist });
    check("token not configured => rejected (no default)", noConfig.ok === false && noConfig.reason.includes("not configured"));
    const noAllowlist = verifyKisWebhook(url, payload, { token: "right-token", senderAllowlist: undefined });
    check("allowlist not configured => rejected", noAllowlist.ok === false && noAllowlist.reason.includes("ALLOWLIST"));
  }

  // 8 — sender not allowlisted => reject
  {
    const url = new URL("http://x/functions/v1/kis-webhook?token=t");
    const payload: KisEmailPayload = { from: '<spoof@evil.example>', envelope: { sender: "spoof@evil.example" } };
    const verdict = verifyKisWebhook(url, payload, { token: "t", senderAllowlist: "kis@example.com" });
    check("sender not allowlisted => rejected", verdict.ok === false && verdict.reason === "sender not allowlisted", JSON.stringify(verdict));
  }

  // idempotency key determinism (same email => same key => duplicate path)
  {
    const payload: KisEmailPayload = { subject: "Engine Stop", from: '<kis@example.com>', timestamp: 1728000000 };
    check("source_event_id deterministic", buildKisSourceEventId(payload) === buildKisSourceEventId({ ...payload }));
    check("source_event_id prefixed", buildKisSourceEventId(payload).startsWith("kis-sha:"));
    const withMsgId = { ...payload, "message-id": "abc@sg" };
    check("provider Message-Id preferred", buildKisSourceEventId(withMsgId) === "kis-msg:abc@sg");
  }

  // 9 — edge function has NO direct DB write
  {
    const edge = readFileSync("supabase/functions/kis-webhook/index.ts", "utf8");
    check("edge has no from(resource_transactions)", !edge.includes("from(") || !/resource_transactions/.test(edge.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => l.includes("from(")).join("\n")));
    check("edge has no .insert(", !edge.includes(".insert("));
    check("edge forwards to internal route", edge.includes("/api/internal/connect/resource-transaction"));
    check("edge verifies webhook (token+allowlist)", edge.includes("verifyKisWebhook"));
    check("edge has no hardcoded 600/35 money fallback", !/base.*600|fuel.*35\\.00|35\\.00|600\\.00/.test(edge));
  }

  // 10 — internal route is the ONLY caller of the canonical writer
  {
    const out = execSync('grep -rl recordResourceTransaction --include="*.ts" . 2>/dev/null | grep -v node_modules | grep -v ".next"', { encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const allowed = new Set(["engines/canonical/resource-transaction-write.ts", "app/api/internal/connect/resource-transaction/route.ts", "scripts/resource-transaction-write-test.ts"]);
    const normalized = out.map((f) => f.replace(/^\.\//, ""));
    const unexpected = normalized.filter((f) => !allowed.has(f));
    check("writer called only by internal route (+writer+test)", unexpected.length === 0, JSON.stringify(normalized));
    const route = readFileSync("app/api/internal/connect/resource-transaction/route.ts", "utf8");
    check("route is secret-gated", route.includes("RESOURCE_TRANSACTION_INTERNAL_SECRET") && route.includes("401"));
    check("route imports canonical writer", route.includes("recordResourceTransaction"));
  }

  console.log(`\\nresource-transaction canonical: checks=${checks} passed=${checks - failures} failed=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
