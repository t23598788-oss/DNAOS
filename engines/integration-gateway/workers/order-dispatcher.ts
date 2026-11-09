// Integration Gateway — Order Dispatcher (2026-11-09).
//
// The missing link between money and trucks:
//
//   PAID order  ->  dispatchOrder  ->  truck_jobs row at BROADCASTED
//                                          |
//                                          v
//                        driver job board (GET /api/driver/available-jobs)
//                                          |
//                                          v
//                        POST /api/driver/tracking { action: "accept" }
//
// Before this file, `broadcastJob()` existed but had ZERO callers: paid orders
// sat with no truck job and trucks had no way to see available work.
//
// Two entry points, one rule set:
//   dispatchOrder(orderId)         — one order, explicit (admin dispatch)
//   dispatchPendingOrders()        — every PAID order without an active job
//                                    (the cron pipeline calls this)
//
// Business model: 1 order = 1 dedicated truck, dispatched immediately after
// payment. A job that already exists and is not DELIVERED means the order is
// already on a truck, so dispatch is a no-op — never a second parallel job.
// The database enforces the same rule with the partial unique index in
// supabase/migrations/20261109160000_truck_job_unique_order.sql.
//
// Deterministic and safe to re-run: dispatchOrder only reads + inserts, and the
// "already dispatched" guard makes every replay a no-op.

import type { SupabaseClient } from "@supabase/supabase-js";
import { broadcastJob } from "./truck-tracker";

/** Options carried through the dispatcher (db injected for testability). */
export interface OrderDispatcherOptions {
  /** Supabase service_role client. */
  db?: SupabaseClient;
}

/** Outcome of one dispatch attempt. `dispatched: false` is a decision, not a failure. */
export interface DispatchResult {
  dispatched: boolean;
  jobId?: string;
  reason?: string;
}

/** One run of the pool scan. */
export interface DispatchPendingResult {
  scanned: number;
  dispatched: number;
  skipped: number;
  errors: string[];
}

/** How many PAID orders one run may look at (no rate limiting beyond this). */
const MAX_ORDERS_PER_RUN = 100;

function requireDb(options: OrderDispatcherOptions): SupabaseClient {
  if (!options.db) {
    throw new Error("order-dispatcher: a Supabase client is required");
  }
  return options.db;
}

/**
 * Dispatch ONE order to the truck pool.
 *
 * Throws only when the order cannot be resolved at all (missing id or missing
 * row) — every business "no" (not paid, already dispatched) is returned so the
 * caller decides how to react.
 */
export async function dispatchOrder(
  orderId: string,
  options: OrderDispatcherOptions = {},
): Promise<DispatchResult> {
  const db = requireDb(options);
  if (!orderId) {
    throw new Error("order-dispatcher: orderId is required");
  }

  // 1. The order must exist.
  const { data: order, error: orderError } = await db
    .from("customer_orders")
    .select("id, order_no, status")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    throw new Error(`order ${orderId} not found`);
  }

  // 2. Only a paid order has a truck. Not an error: an unpaid order is simply
  //    not dispatchable yet.
  const status = typeof order.status === "string" ? order.status : "";
  if (status !== "PAID") {
    return { dispatched: false, reason: `order status ${status} is not PAID` };
  }

  // 3. One dedicated truck per order. A job that has not reached DELIVERED is
  //    still in flight, so there is nothing to dispatch.
  const { data: activeJobs, error: jobsError } = await db
    .from("truck_jobs")
    .select("id")
    .eq("order_id", orderId)
    .neq("current_status", "DELIVERED")
    .limit(1);

  if (jobsError) {
    throw new Error(
      `order-dispatcher: failed to read truck_jobs for order ${orderId}: ${jobsError.message}`,
    );
  }

  const existing = (activeJobs ?? [])[0];
  if (existing) {
    return {
      dispatched: false,
      jobId: String(existing.id),
      reason: "already dispatched",
    };
  }

  // 4. Open the stream. broadcastJob writes the job at BROADCASTED and logs
  //    JOB_BROADCASTED as actor "system".
  const job = await broadcastJob(orderId, { db });

  return { dispatched: true, jobId: job.id };
}

/**
 * Find every PAID order that has no active job and dispatch it.
 *
 * Never throws: a per-order failure (or an empty pool read) is reported in
 * `errors` so one bad row cannot stop the rest of the run.
 */
export async function dispatchPendingOrders(
  options: OrderDispatcherOptions = {},
): Promise<DispatchPendingResult> {
  const db = requireDb(options);

  const { data: orders, error: readError } = await db
    .from("customer_orders")
    .select("id")
    .eq("status", "PAID")
    .limit(MAX_ORDERS_PER_RUN);

  if (readError) {
    return {
      scanned: 0,
      dispatched: 0,
      skipped: 0,
      errors: [`failed to read PAID orders: ${readError.message}`],
    };
  }

  const rows = (orders ?? []) as Array<{ id: string }>;
  let dispatched = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const result = await dispatchOrder(String(row.id), options);
      if (result.dispatched) {
        dispatched += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`order ${row.id}: ${message}`);
    }
  }

  return { scanned: rows.length, dispatched, skipped, errors };
}
