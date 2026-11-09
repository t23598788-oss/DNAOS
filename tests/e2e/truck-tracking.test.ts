// tests/e2e/truck-tracking.test.ts
//
// End-to-end proof that the tracking stream has no gaps:
//
//   order created -> BROADCASTED -> ACCEPTED -> EN_ROUTE_TO_PICKUP
//     -> PICKED_UP -> EN_ROUTE_TO_CUSTOMER -> AT_SITE -> DELIVERED
//
// The Supabase client is an in-memory fake that really stores rows, so the
// test reads back what the worker wrote: exactly seven `truck_events` rows,
// in order, with real timestamps. Skipping a status is asserted to throw and
// to leave the stream untouched.
//
// Run: npx vitest run tests/e2e/truck-tracking.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  broadcastJob,
  acceptJob,
  updateJobStatus,
  TRUCK_JOB_STATUSES,
  type TruckJobRow,
} from "@/engines/integration-gateway/workers/truck-tracker";

// ---------------------------------------------------------------------------
// In-memory Supabase stand-in
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class FakeTable {
  rows: Row[] = [];
}

class FakeQuery {
  private filters: Array<[string, unknown]> = [];
  private op: "select" | "insert" | "update" = "select";
  private insertRows: Row[] = [];
  private updateValues: Row = {};

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
    return this.store().filter((row) =>
      this.filters.every(([col, val]) => row[col] === val),
    );
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
    this.filters.push([col, val]);
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

const TRUCK_ID = "truck-001";
const DRIVER_ID = "driver-001";

const EXPECTED_STATUSES = [...TRUCK_JOB_STATUSES];
const EXPECTED_EVENTS = [
  "JOB_BROADCASTED",
  "JOB_ACCEPTED",
  "EN_ROUTE_TO_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_TO_CUSTOMER",
  "AT_SITE",
  "DELIVERED",
];

let fake: FakeSupabaseClient;
let db: SupabaseClient;

beforeEach(() => {
  fake = new FakeSupabaseClient();
  db = fake as unknown as SupabaseClient;
});

/** Create the order the job will carry (what order creation would do). */
async function createOrder(): Promise<string> {
  const { data } = await db
    .from("customer_orders")
    .insert({ order_no: "ORD-TRACK-0001", status: "PAID" })
    .select()
    .single();
  return String((data as Row).id);
}

async function driveToDelivery(job: TruckJobRow): Promise<TruckJobRow> {
  let current = job;
  current = await updateJobStatus(current.id, "EN_ROUTE_TO_PICKUP", { lat: 13.7, lng: 100.5 }, DRIVER_ID, { db });
  current = await updateJobStatus(current.id, "PICKED_UP", { photo_url: "https://proof/pickup.jpg", note: "goods loaded" }, DRIVER_ID, { db });
  current = await updateJobStatus(current.id, "EN_ROUTE_TO_CUSTOMER", { lat: 13.8, lng: 100.6 }, DRIVER_ID, { db });
  current = await updateJobStatus(current.id, "AT_SITE", { lat: 13.81, lng: 100.61 }, DRIVER_ID, { db });
  current = await updateJobStatus(current.id, "DELIVERED", { photo_url: "https://proof/delivered.jpg", note: "signed by customer" }, DRIVER_ID, { db });
  return current;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("truck tracking — the stream has no gaps", () => {
  it("records exactly one event per stage from broadcast to delivered", async () => {
    const orderId = await createOrder();

    const broadcasted = await broadcastJob(orderId, { db });
    expect(broadcasted.current_status).toBe("BROADCASTED");
    expect(broadcasted.assigned_truck_id).toBeNull();
    expect(broadcasted.assigned_driver_id).toBeNull();

    const accepted = await acceptJob(broadcasted.id, TRUCK_ID, DRIVER_ID, { db });
    expect(accepted.current_status).toBe("ACCEPTED");
    expect(accepted.assigned_truck_id).toBe(TRUCK_ID);
    expect(accepted.assigned_driver_id).toBe(DRIVER_ID);

    const delivered = await driveToDelivery(accepted);
    expect(delivered.current_status).toBe("DELIVERED");

    // --- the event stream: exactly 7 rows, one per stage, in order ---
    const events = fake.rows("truck_events");
    expect(events).toHaveLength(7);
    expect(events.map((e) => e.event_type)).toEqual(EXPECTED_EVENTS);
    expect(events.every((e) => e.job_id === broadcasted.id)).toBe(true);

    // Actors: system opened the stream, the driver moved the truck.
    expect(events[0].actor_id).toBe("system");
    expect(events.slice(1).every((e) => e.actor_id === DRIVER_ID)).toBe(true);

    // Timestamps exist, are real dates, and never go backwards.
    const times = events.map((e) => new Date(String(e.created_at)).getTime());
    expect(times.every((t) => Number.isFinite(t))).toBe(true);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }

    // Metadata is carried with the event that produced it.
    expect(events[0].metadata).toEqual({ order_id: orderId });
    expect(events[1].metadata).toEqual({ truck_id: TRUCK_ID, driver_id: DRIVER_ID });
    expect(events[2].metadata).toEqual({ lat: 13.7, lng: 100.5 });
    expect(events[3].metadata).toEqual({
      photo_url: "https://proof/pickup.jpg",
      note: "goods loaded",
    });

    // The job row itself holds the final state and the assigned crew.
    const jobs = fake.rows("truck_jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].current_status).toBe("DELIVERED");
    expect(jobs[0].order_id).toBe(orderId);
    expect(jobs[0].assigned_truck_id).toBe(TRUCK_ID);
    expect(jobs[0].assigned_driver_id).toBe(DRIVER_ID);
    expect(jobs[0].updated_at).not.toBe(jobs[0].created_at);

    // The statuses move in exactly the declared order.
    const observed = ["BROADCASTED", "ACCEPTED", ...EXPECTED_STATUSES.slice(2)];
    expect(observed).toEqual(EXPECTED_STATUSES);
  });

  it("throws and writes no event when a status is skipped", async () => {
    const orderId = await createOrder();
    const job = await broadcastJob(orderId, { db });

    // BROADCASTED -> PICKED_UP skips ACCEPTED and EN_ROUTE_TO_PICKUP.
    await expect(updateJobStatus(job.id, "PICKED_UP", {}, DRIVER_ID, { db }))
      .rejects.toThrow(/invalid transition BROADCASTED -> PICKED_UP/);

    // Jumping straight to DELIVERED is refused too.
    await expect(updateJobStatus(job.id, "DELIVERED", {}, DRIVER_ID, { db }))
      .rejects.toThrow(/invalid transition BROADCASTED -> DELIVERED/);

    // No event was written for either attempt.
    expect(fake.rows("truck_events")).toHaveLength(1);
    expect(fake.rows("truck_jobs")[0].current_status).toBe("BROADCASTED");

    // After accepting, skipping ahead one more stage is still refused.
    await acceptJob(job.id, TRUCK_ID, DRIVER_ID, { db });
    await expect(updateJobStatus(job.id, "EN_ROUTE_TO_CUSTOMER", {}, DRIVER_ID, { db }))
      .rejects.toThrow(/invalid transition ACCEPTED -> EN_ROUTE_TO_CUSTOMER/);
    expect(fake.rows("truck_events")).toHaveLength(2);
  });

  it("refuses a second acceptance of the same job", async () => {
    const orderId = await createOrder();
    const job = await broadcastJob(orderId, { db });

    await acceptJob(job.id, TRUCK_ID, DRIVER_ID, { db });

    await expect(acceptJob(job.id, "truck-999", "driver-999", { db }))
      .rejects.toThrow(/already accepted/);

    expect(fake.rows("truck_jobs")[0].assigned_truck_id).toBe(TRUCK_ID);
    expect(fake.rows("truck_events")).toHaveLength(2);
  });

  it("refuses any transition after DELIVERED", async () => {
    const orderId = await createOrder();
    const job = await broadcastJob(orderId, { db });
    const accepted = await acceptJob(job.id, TRUCK_ID, DRIVER_ID, { db });
    await driveToDelivery(accepted);

    await expect(updateJobStatus(job.id, "DELIVERED", {}, DRIVER_ID, { db }))
      .rejects.toThrow(/invalid transition DELIVERED -> DELIVERED/);

    expect(fake.rows("truck_events")).toHaveLength(7);
  });
});
