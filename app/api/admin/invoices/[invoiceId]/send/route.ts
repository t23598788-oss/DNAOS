import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { sendInvoiceToLine } from "@/gateway/actions";

type Params = { params: Promise<{ invoiceId: string }> };

// Retry Send (owner, 2026-07-17, Invoice Workflow Redesign): "If LINE Push
// fails, the invoice must remain saved with status = CREATED and allow
// Retry Send without recreating the invoice." This is that retry path —
// calls SendInvoiceToLINE(invoiceId) directly, standalone, on an already-
// confirmed invoice. Safe to call repeatedly: sendInvoiceToLine() itself
// refuses to re-push an invoice already at status SENT.
export async function POST(_req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { invoiceId } = await params;
  const result = await sendInvoiceToLine(invoiceId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
