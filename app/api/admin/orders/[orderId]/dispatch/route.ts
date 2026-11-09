/**
 * POST /api/admin/orders/[orderId]/dispatch — manual truck dispatch (2026-11-09).
 *
 * The human override for the automatic path: the cron pipeline dispatches every
 * PAID order that has no active job, and this route lets an admin push ONE order
 * immediately (e.g. the order was paid after the last cron tick).
 *
 * Auth is the canonical admin guard used by every other route under
 * app/api/admin/** (core/auth/requireAuth + ADMIN_TIER) — no new scheme.
 *
 * `dispatched: false` is a normal outcome, not an error: the order is not PAID
 * yet, or it already has a truck on the way. Only a missing order is a 404.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { dispatchOrder } from "@/engines/integration-gateway/workers/order-dispatcher";

type Params = { params: Promise<{ orderId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { orderId } = await params;
  if (typeof orderId !== "string" || orderId.trim() === "") {
    return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
  }

  try {
    const result = await dispatchOrder(orderId, { db: supabaseAdmin() });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (/not found/.test(message)) {
      return NextResponse.json({ ok: false, error: "order not found" }, { status: 404 });
    }

    // Anything else is a real failure (DB/auth-of-service-role/storage), and it
    // still leaves the caller a JSON body to read.
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
