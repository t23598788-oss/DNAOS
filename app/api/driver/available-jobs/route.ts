/**
 * GET /api/driver/available-jobs — the driver job board (2026-11-09).
 *
 * Returns every job waiting for a truck: truck_jobs rows still at BROADCASTED,
 * newest first. A driver picks one and calls
 * POST /api/driver/tracking { action: "accept", jobId, truckId, driverId }.
 *
 * Auth is the same driver token check as the tracking endpoint
 * (app/api/driver/_lib/driver-auth.ts) — the two surfaces cannot drift apart.
 *
 * The embedded customer_orders(order_no) is one FK hop on a column that exists
 * today. `requested_delivery_at` is deliberately NOT selected: no such column
 * exists on customer_orders in any migration, and inventing one here would make
 * the board lie about a delivery time the business never recorded.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/queries";
import { requireDriverToken } from "../_lib/driver-auth";

/** How many waiting jobs one driver sees at a time. */
const JOB_BOARD_LIMIT = 50;

export async function GET(request: NextRequest) {
  const auth = requireDriverToken(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin()
    .from("truck_jobs")
    .select(
      "id, order_id, assigned_truck_id, assigned_driver_id, current_status, created_at, updated_at, customer_orders(order_no)",
    )
    .eq("current_status", "BROADCASTED")
    .order("created_at", { ascending: false })
    .limit(JOB_BOARD_LIMIT);

  if (error) {
    return NextResponse.json(
      { ok: false, error: `failed to read available jobs: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, jobs: data ?? [] });
}
