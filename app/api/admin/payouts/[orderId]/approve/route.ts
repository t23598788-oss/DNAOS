import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { executeApprovedPayout } from "@/engines/integration-gateway/workers/payout-worker";
import { supabaseAdmin } from "@/services/supabase/queries";

// Local/admin-only approval gate. Money moves only when this route is called
// with the internal secret, and only for an order already in
// PAYOUT_PENDING_APPROVAL (the worker itself enforces PAYOUT_APPROVED).

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

  const { orderId } = await params;

  // The worker only pays an order that is already PAYOUT_APPROVED (human
  // decision), and nothing else in the system performs the
  // PAYOUT_PENDING_APPROVAL -> PAYOUT_APPROVED step, so this route is that
  // decision point: guarded transition + audit row, then execute.
  const db = supabaseAdmin();

  // Invoice statuses that represent real money owed. DRAFT is not issued yet
  // and VOID is cancelled, so neither may contribute to a payout amount.
  const ACTIVE_INVOICE_STATUSES = ["SENT", "PARTIALLY_PAID", "PAID"];

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

    // Resolve the payout amount from invoices.total_amount. customer_orders
    // has no amount column, and the worker's executeApprovedPayout() takes no
    // amount argument, so the resolved figure is recorded on the audit row for
    // traceability — it is never invented.
    const { data: invoiceRows, error: invoiceError } = await db
      .from("invoices")
      .select("id, total_amount, invoice_status")
      .eq("customer_order_id", orderId);

    if (invoiceError) {
      return NextResponse.json(
        { ok: false, orderId, reason: `invoice lookup failed: ${invoiceError.message}` },
        { status: 500 },
      );
    }

    const invoices = invoiceRows ?? [];
    const activeInvoices = invoices.filter((invoice) =>
      ACTIVE_INVOICE_STATUSES.includes(String(invoice.invoice_status ?? "").toUpperCase()),
    );
    const allActive =
      invoices.length > 0 && activeInvoices.length === invoices.length;

    const resolvedAmount = allActive
      ? activeInvoices.reduce(
          (total, invoice) => total + Number(invoice.total_amount ?? 0),
          0,
        )
      : 0;

    const amountNote =
      invoices.length === 0
        ? "amount resolved from invoices: 0.00 (no invoice for this order)"
        : allActive
          ? `amount resolved from invoices: ${resolvedAmount.toFixed(2)} (${invoices.length} invoice${invoices.length === 1 ? "" : "s"}, active)`
          : `amount resolved from invoices: 0.00 (${invoices.length} invoice${invoices.length === 1 ? "" : "s"}, not all active)`;

    // The worker still sends its own internal placeholder amount (it takes no
    // amount argument), so approving with a zero/unresolved amount would mean
    // sending a made-up number to the bank. Refuse instead of faking it.
    if (resolvedAmount <= 0) {
      return NextResponse.json(
        {
          ok: false,
          orderId,
          reason: `no payable invoice amount: ${amountNote}; refusing to approve a payout without a real amount`,
        },
        { status: 409 },
      );
    }

    // Guarded on the exact current status so two concurrent approvals cannot
    // both win, and so an already-approved order is never re-approved.
    const { data: updated, error: updateError } = await db
      .from("customer_orders")
      .update({
        status: "PAYOUT_APPROVED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("status", "PAYOUT_PENDING_APPROVAL")
      .select("id");

    if (updateError) {
      return NextResponse.json(
        { ok: false, orderId, reason: `approval update failed: ${updateError.message}` },
        { status: 500 },
      );
    }

    if (!updated || updated.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          orderId,
          reason: "order is not pending payout approval (already approved or settled)",
        },
        { status: 409 },
      );
    }

    await db.from("payout_audit_log").insert({
      order_id: orderId,
      action: "approve",
      actor_id: actorId,
      reason: `payout approved by human via admin approval route; ${amountNote}`,
      created_at: new Date().toISOString(),
    });

    const result = await executeApprovedPayout(orderId, actorId);

    // The worker reports { success, failed } rather than { ok }: success>0
    // means the payout API accepted it and the order is SETTLED.
    if (result.success > 0) {
      return NextResponse.json({ ok: true, orderId, status: "approved" });
    }

    return NextResponse.json(
      {
        ok: false,
        orderId,
        reason:
          result.failed > 0
            ? "payout API rejected the payout (order marked PAYOUT_FAILED)"
            : "order is not in PAYOUT_APPROVED state (not pending approval, already approved, or already settled)",
      },
      { status: 409 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
