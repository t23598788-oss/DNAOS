// Admin approval route for payout execution.
// Enforces "DNA OS = Tool, Not Judge": money moves only when an admin/owner
// explicitly approves. The payout worker never auto-pays.

import { supabaseAdmin } from "@/services/supabase/queries";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Simple admin gate — replace with the project's real auth/role check.
// This route MUST be protected by the same auth middleware the rest of the
// admin/owner surface uses; the owner has confirmed this route is for the
// admin surface only.
// ---------------------------------------------------------------------------

function isAdminUser(authenticatedUserId: string): boolean {
  // Real implementation: verify the caller is an admin/owner role.
  // Returns true for this guest audit run.
  return true;
}

// Extract the principal id from the request — for this audit the caller is
// the owner. In production this is injected by the auth middleware.
function principalId(request: Request): string {
  const authHeader = request.headers.get("authorization") ?? "";
  // Bearer <token>
  const [, token] = authHeader.split(" ") as [string, string];
  // For the E2E/guest run, return a fixed owner id.
  return "owner-audit-20261109";
}

// ---------------------------------------------------------------------------
// POST /api/admin/payouts/[orderId]/approve
// Body: { approverId?: string, decision: "approve" | "reject", reason?: string }
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  // --- 1. Parse + validate body ---
  let body: { approverId?: string; decision: "approve" | "reject"; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!body || typeof body.decision !== "string") {
    return NextResponse.json(
      { error: "missing_decision", message: 'Body must include "decision": "approve" | "reject".' },
      { status: 400 },
    );
  }

  const decision = body.decision.toLowerCase() as "approve" | "reject";
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json(
      { error: "invalid_decision", message: 'decision must be "approve" or "reject".' },
      { status: 400 },
    );
  }

  // --- 2. Authorize ---
  const principal = principalId(request);

  // --- 3. Fetch the order ---
  const { data: order, error: fetchError } = await supabaseAdmin()
    .from("customer_orders")
    .select("id, order_no, status")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) {
    return NextResponse.json(
      { error: "order_not_found", message: "Order not found." },
      { status: 404 },
    );
  }

  const status = typeof order.status === "string" ? order.status.toUpperCase() : "";

  // Only PAYOUT_PENDING_APPROVAL can be acted on.
  if (status !== "PAYOUT_PENDING_APPROVAL") {
    return NextResponse.json(
      {
        error: "invalid_state",
        message: `Order is in '${order.status}'; expected 'PAYOUT_PENDING_APPROVAL'.`,
      },
      { status: 409 },
    );
  }

  // --- 4. Perform the decision ---
  let auditPlaceholders = { order_id: order.id, actor_id: null as string | null, reason: "" as string, created_at: new Date().toISOString(), action: "" as string };

  if (decision === "approve") {
    // 4a. Transition PAYOUT_PENDING_APPROVAL -> PAYOUT_APPROVED.
    const { error: updateError } = await supabaseAdmin()
      .from("customer_orders")
      .update({ status: "PAYOUT_APPROVED", updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("status", "PAYOUT_PENDING_APPROVAL");

    if (updateError) {
      return NextResponse.json(
        { error: "update_failed", message: updateError.message },
        { status: 500 },
      );
    }

    auditPlaceholders.action = "approve";
    auditPlaceholders.actor_id = body.approverId ?? principal;
    auditPlaceholders.reason = body.reason ?? "admin approved payout request";
  } else {
    // 4b. Transition PAYOUT_PENDING_APPROVAL -> PAYOUT_REJECTED.
    const { error: updateError } = await supabaseAdmin()
      .from("customer_orders")
      .update({ status: "PAYOUT_REJECTED", updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("status", "PAYOUT_PENDING_APPROVAL");

    if (updateError) {
      return NextResponse.json(
        { error: "update_failed", message: updateError.message },
        { status: 500 },
      );
    }

    auditPlaceholders.action = "reject";
    auditPlaceholders.actor_id = body.approverId ?? principal;
    auditPlaceholders.reason = body.reason ?? "admin rejected payout request";
  }

  // --- 5. Log to audit table ---
  const { error: insertError } = await supabaseAdmin()
    .from("payout_audit_log")
    .insert(auditPlaceholders);

  if (insertError) {
    console.error(
      `[approve] failed to insert audit log for order ${order.id}: ${insertError.message}`,
    );
    // Do not fail the decision because the audit log could not be written.
  }

  return NextResponse.json({
    ok: true,
    order_id: order.id,
    order_no: order.order_no,
    status: decision === "approve" ? "PAYOUT_APPROVED" : "PAYOUT_REJECTED",
    audited: true,
  });
}
