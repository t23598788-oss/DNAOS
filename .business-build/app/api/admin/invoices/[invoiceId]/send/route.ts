import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { sendInvoiceToLine } from "@/gateway/actions";
import {
  normalizeGatewayResult,
  isProviderPushFailure,
} from "@/app/api/admin/ide/_lib/businessFailureBridge";

type Params = { params: Promise<{ invoiceId: string }> };

// Retry Send (owner, 2026-07-17, Invoice Workflow Redesign): "If LINE Push
// fails, the invoice must remain saved with status = CREATED and allow
// Retry Send without recreating the invoice." This is that retry path — calls
// SendInvoiceToLINE(invoiceId, actor) directly, standalone, on an already-
// confirmed invoice. PHASE C (2026-09-23): idempotency now comes from DELIVERY
// EVIDENCE (line_events direction "out" for this document), not from
// invoice_status — document status is owned by issueDocument() alone.
export async function POST(_req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { invoiceId } = await params;
  const result = await sendInvoiceToLine(invoiceId, auth.email);
  if (result.ok) return NextResponse.json(result, { status: 200 });

  // Business → Infrastructure failure bridge (owner, 2026-09-19): only the
  // real provider push failure is infrastructure-owned. Business-data
  // failures (not found / already SENT / no LINE link) stay plain business
  // results. Business receives ONLY the normalized result — never raw
  // provider error text.
  if (!isProviderPushFailure(result.error ?? "")) {
    return NextResponse.json(result, { status: 400 });
  }
  const normalized = await normalizeGatewayResult(result, {
    providerSlug: "line",
    businessAction: "invoice.send",
    ownerId: auth.id,
    actor: auth.email,
    source: "/api/admin/invoices/[invoiceId]/send",
  });
  return NextResponse.json(normalized, { status: 503 });
}
