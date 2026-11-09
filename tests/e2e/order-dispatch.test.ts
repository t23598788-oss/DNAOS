// tests/e2e/order-dispatch.test.ts
//
// End-to-end proof of the dispatch link between money and trucks:
//
//   PAID order -> dispatchOrder -> truck_jobs row at BROADCASTED
//   driver board (GET /api/driver/available-jobs) shows it
//   admin route (POST /api/admin/orders/[orderId]/dispatch) can push one order
//
// The Supabase client is the same in-memory fake pattern as
// truck-tracking.test.ts (really stores rows, reads back what the worker
// wrote), extended with the three query operators the dispatcher and the job
// board need: neq(), order() and limit().
//
// IMPORTANT: the DB-level guard (the partial unique index in
// supabase/migrations/20261109160000_truck_job_unique_order.sql) CANNOT be
// exercised by an in-memory fake. What Test 3 proves is the code-level guard in
// order-dispatcher.ts (the "already dispatched" check). The index is what makes
// the same rule true when two dispatchers race in production.
//
// Run: npx vitest run tests/e2e/order-dispatch.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Mocks (hoisted): the routes read their clients/identity from these modules.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  db: null as unknown,
}));

vi.mock("@/services/supabase/queries", () => ({
  supabaseAdmin: () => h.db,
}));

// No session -> the REAL requireAuth returns its real 401. ADMIN_TIER and the
// rest of the session module stay real (importOriginal), so this test exercises
// the actual admin gate rather than a stub of it.
vi.mock("@/core/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/auth/session")>();
  return { ...actual, getAuthedUser: vi.fn(async () => null) };
});

import {
  dispatchOrder,
  dispatchPendingOrders,
} from "@/engines/integration-gateway/workers/order-dispatcher";
import { broadcastJob } from "@/engines/integration-gateway/workers/truck-tracker";
import { POST as adminDispatch } from "@/app/api/admin/orders/[orderId]/dispatch/route";
import { GET as availableJobs } from "@/app/api/driver/available-jobs/route";

// ---------------------------------------------------------------------------
// In-memory Supabase stand-in (same pattern as truck-tracking.test.ts)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class FakeTable {
  rows: Row[] = [];
}

class FakeQuery {
  private filters: Array<{ col: string; val: unknown; op: "eq" | "neq" }> = [];
  private op: "select" | "insert" | "update" = "select";
  private insertRows: Row[] = [];
  private updateValues: Row = {};
  private maxRows: number | null = null;

  constructor(
    private tables: Map<string, FakeTable>,
    private table: string,
  ) {}

  private store(): Row[] {
    let t = this.tables.get(this.table);
    if (!t) {
      t = new FakeTable();
      this.tables.set(this.table, t);
    }
    return t.rows;
  }

  private matched(): Row[] {
    const rows = this.store().filter((row) =>
      this.filters.every(({ col, val, op }) =>
        op === "eq" ? row[col] === val : row[col] !== val,
      ),
    );
    return this.maxRows === null ? rows : rows.slice(0, this.maxRows);
  }

  select(..._cols: unknown[]): FakeQuery {
    // `.select()` after `.insert()` is a "return the written row" modifier.
    return this;
  }

  insert(values: Row | Row[]): FakeQuery {
    this.op = "insert";
    this.insertRows = Array.isArray(values) ? values : [values];
    return this;
  }

  update(values: Row): FakeQuery {
    this.op = "update";
    this.updateValues = values;
    return this;
  }

  eq(col: string, val: unknown): FakeQuery {
    this.filters.push({ col, val, op: "eq" });
    return this;
  }

  neq(col: string, val: unknown): FakeQuery {
    this.filters.push({ col, val, op: "neq" });
    return this;
  }

  order(_col: string, _opts?: unknown): FakeQuery {
    // Row order is irrelevant to every assertion here; keep insertion order.
    return this;
  }

  limit(n: number): FakeQuery {
    this.maxRows = n;
    return this;
  }

  private execute(): { data: Row[]; error: Error | null } {
    if (this.op === "insert") {
      const created = this.insertRows.map((values) => ({
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...values,
      }));
      this.store().push(...created);
      return { data: created, error: null };
    }

    if (this.op === "update") {
      const matched = this.matched();
      for (const row of matched) Object.assign(row, this.updateValues);
      return { data: matched, error: null };
    }

    return { data: this.matched(), error: null };
  }

  single(): { data: Row | null; error: Error | null } {
    const { data, error } = this.execute();
    return { data: data[0] ?? null, error };
  }

  then<T>(
    resolve: (value: { data: Row[]; error: Error | null }) => T,
  ): Promise<T> {
    return Promise.resolve(this.execute()).then(resolve);
  }
}

class FakeSupabaseClient {
  readonly tables = new Map<string, FakeTable>();

  from(table: string): FakeQuery {
    return new FakeQuery(this.tables, table);
  }

  rows(table: string): Row[] {
    return this.tables.get(table)?.rows ?? [];
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET = "test-driver-secret";

let fake: FakeSupabaseClient;
let db: SupabaseClient;
const originalSecret = process.env.DRIVER_TRACKING_SECRET;

beforeEach(() => {
  fake = new FakeSupabaseClient();
  db = fake as unknown as SupabaseClient;
  h.db = db;
  process.env.DRIVER_TRACKING_SECRET = SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.DRIVER_TRACKING_SECRET;
  else process.env.DRIVER_TRACKING_SECRET = originalSecret;
});

/** Create an order in the given status (what order creation / payment would do). */
async function createOrder(status: string, orderNo = "ORD-DISPATCH-0001"): Promise<string> {
  const { data } = await (db
    .from("customer_orders")
    .insert({ order_no: orderNo, status })
    .select()
    .single() as unknown as Promise<{ data: Row | null }>);
  return String((data as Row).id);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

describe("order dispatch — PAID order becomes a truck job", () => {
  it("dispatches a PAID order into exactly one BROADCASTED job", async () => {
    const orderId = await createOrder("PAID");

    const result = await dispatchOrder(orderId, { db });

    expect(result.dispatched).toBe(true);
    expect(result.jobId).toBeTruthy();

    const jobs = fake.rows("truck_jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].order_id).toBe(orderId);
    expect(jobs[0].current_status).toBe("BROADCASTED");
    expect(jobs[0].id).toBe(result.jobId);

    // The stream opens with exactly one JOB_BROADCASTED event, actor "system".
    const events = fake.rows("truck_events");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("JOB_BROADCASTED");
    expect(events[0].actor_id).toBe("system");
  });

  it("refuses a non-PAID order without creating a job", async () => {
    const orderId = await createOrder("DRAFT");

    const result = await dispatchOrder(orderId, { db });

    expect(result.dispatched).toBe(false);
    expect(result.jobId).toBeUndefined();
    expect(result.reason).toContain("is not PAID");
    expect(result.reason).toContain("DRAFT");

    expect(fake.rows("truck_jobs")).toHaveLength(0);
    expect(fake.rows("truck_events")).toHaveLength(0);
  });

  it("is idempotent: a second dispatch reports 'already dispatched' and creates no second job", async () => {
    // Code-level guard only — the partial unique index
    // (truck_jobs_one_active_per_order) is the same rule at DB level and is not
    // modelled by this in-memory fake.
    const orderId = await createOrder("PAID");

    const first = await dispatchOrder(orderId, { db });
    expect(first.dispatched).toBe(true);

    const second = await dispatchOrder(orderId, { db });

    expect(second.dispatched).toBe(false);
    expect(second.reason).toBe("already dispatched");
    expect(second.jobId).toBe(first.jobId);
    expect(fake.rows("truck_jobs")).toHaveLength(1);
    expect(fake.rows("truck_events")).toHaveLength(1);
  });

  it("throws for an order that does not exist", async () => {
    await expect(dispatchOrder("00000000-0000-0000-0000-000000000000", { db }))
      .rejects.toThrow(/not found/);
  });
});

describe("order dispatch — pending pool scan", () => {
  it("dispatches only PAID orders and leaves DRAFT orders untouched", async () => {
    const paidA = await createOrder("PAID", "ORD-A");
    const paidB = await createOrder("PAID", "ORD-B");
    const draft = await createOrder("DRAFT", "ORD-C");

    const summary = await dispatchPendingOrders({ db });

    expect(summary.scanned).toBe(2); // only PAID rows are read
    expect(summary.dispatched).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toEqual([]);

    const jobs = fake.rows("truck_jobs");
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.current_status === "BROADCASTED")).toBe(true);
    expect(jobs.map((j) => j.order_id).sort()).toEqual([paidA, paidB].sort());
    expect(jobs.some((j) => j.order_id === draft)).toBe(false);
  });

  it("skips a PAID order that already has an active job", async () => {
    const orderId = await createOrder("PAID");
    const existing = await broadcastJob(orderId, { db });

    const summary = await dispatchPendingOrders({ db });

    expect(summary.scanned).toBe(1);
    expect(summary.dispatched).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toEqual([]);

    expect(fake.rows("truck_jobs")).toHaveLength(1);
    expect(fake.rows("truck_jobs")[0].id).toBe(existing.id);
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe("routes — admin dispatch and driver job board", () => {
  it("POST /api/admin/orders/[orderId]/dispatch is 401 without admin auth", async () => {
    const orderId = await createOrder("PAID");

    const res = await adminDispatch(
      new Request(`http://localhost/api/admin/orders/${orderId}/dispatch`, { method: "POST" }) as never,
      { params: Promise.resolve({ orderId }) },
    );

    expect([401, 403]).toContain(res.status);

    // The gate runs before any dispatch: nothing was created.
    expect(fake.rows("truck_jobs")).toHaveLength(0);
  });

  it("GET /api/driver/available-jobs is 401 without the driver token", async () => {
    const res = await availableJobs(
      new Request("http://localhost/api/driver/available-jobs") as never,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("missing driver token");
  });

  it("GET /api/driver/available-jobs returns waiting jobs with a valid token", async () => {
    const orderId = await createOrder("PAID");
    const job = await broadcastJob(orderId, { db });

    const res = await availableJobs(
      new Request("http://localhost/api/driver/available-jobs", {
        headers: { "x-driver-token": SECRET },
      }) as never,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; jobs: Row[] };
    expect(body.ok).toBe(true);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].id).toBe(job.id);
    expect(body.jobs[0].order_id).toBe(orderId);
    expect(body.jobs[0].current_status).toBe("BROADCASTED");
  });
});
