import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/services/supabase/queries";

// Admin-only reject gate: a human says "no" to a payout. Metadata only — no
// KBank call, no refund, no truck_job deletion. Same fail-closed secret gate as
// the approve route (constant-time compare against PAYOUT_APPROVAL_SECRET).

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const expectedSecret = process.env.PAYOUT_APPROVAL_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "payout approval not configured" },
      { status: 503 },
    );
  }

  const providedSecret = req.headers.get("x-admin-secret");
  if (!providedSecret || !secretMatches(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const rawActorId =
    body && typeof body === "object"
      ? (body as { actorId?: unknown }).actorId
      : undefined;
  const actorId = typeof rawActorId === "string" ? rawActorId.trim() : "";

  if (!actorId) {
    return NextResponse.json({ error: "actorId is required" }, { status: 400 });
  }

  const rawReason =
    body && typeof body === "object"
      ? (body as { reason?: unknown }).reason
      : undefined;
  const providedReason =
    typeof rawReason === "string" ? rawReason.trim() : "";
  const auditReason = providedReason
    ? providedReason
    : "payout rejected by human via admin reject route";

  const { orderId } = await params;
  const db = supabaseAdmin();

  try {
    const { data: order, error: fetchError } = await db
      .from("customer_orders")
      .select("id, order_no, status")
      .eq("id", orderId)
      .single();

    if (fetchError || !order) {
      return NextResponse.json(
        { ok: false, orderId, reason: "order not found" },
        { status: 404 },
      );
    }

    const currentStatus = String(order.status ?? "").toUpperCase();
    if (currentStatus !== "PAYOUT_PENDING_APPROVAL") {
      return NextResponse.json(
        {
          ok: false,
          orderId,
          reason: `order is not pending payout approval (current: ${currentStatus || "unknown"})`,
        },
        { status: 409 },
      );
    }

    // Guarded on the exact current status so a concurrent approve/reject
    // cannot both win.
    const { data: updated, error: updateError } = await db
      .from("customer_orders")
      .update({
        status: "PAYOUT_REJECTED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("status", "PAYOUT_PENDING_APPROVAL")
      .select("id");

    if (updateError) {
      return NextResponse.json(
        { ok: false, orderId, reason: `reject update failed: ${updateError.message}` },
        { status: 500 },
      );
    }

    if (!updated || updated.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          orderId,
          reason: "order is not pending payout approval (already approved, rejected, or settled)",
        },
        { status: 409 },
      );
    }

    await db.from("payout_audit_log").insert({
      order_id: orderId,
      action: "reject",
      actor_id: actorId,
      reason: auditReason,
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, orderId, status: "rejected" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
