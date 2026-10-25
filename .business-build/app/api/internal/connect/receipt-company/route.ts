/**
 * POST /api/internal/connect/receipt-company — Connect receipt debtor-assignment
 * bridge (BOM-070 FINAL HARDENING · owner approved 2026-10-14).
 *
 * The provider tier (Deno) may no longer write receipt_documents.customer_company_id
 * directly. This is the ONE internal path for that assignment: it reuses the same
 * gate + write + Canonical Audit as the manual admin route
 * (app/api/admin/receipt-documents/[id]/company/route.ts), so the sweep and the
 * manual button share one canonical behaviour — no parallel writer.
 *
 *   Edge sweep → resolveExternalIdentity → POST .../receipt-company
 *     → receipt_documents.customer_company_id + recordCanonicalAudit(document.updated)
 *
 * Auth: one secret per bridge — RECEIPT_COMPANY_INTERNAL_SECRET (fail closed, same
 * shape as PAYMENT_CONFIRM / INBOUND_SOURCE internal bridges).
 * Body: { receipt_document_id, customer_company_id, actor } — no amount, no row shape.
 */
import { NextResponse } from "next/server";
import { assignReceiptCompany } from "@/engines/canonical/receipt-company-assignment";

interface ReceiptCompanyRequest {
  receipt_document_id?: string;
  customer_company_id?: string;
  actor?: string;
}

export async function POST(req: Request) {
  const secret = process.env.RECEIPT_COMPANY_INTERNAL_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "RECEIPT_COMPANY_INTERNAL_SECRET not configured" }, { status: 503 });
  }
  if (req.headers.get("x-receipt-company-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  let body: ReceiptCompanyRequest;
  try {
    body = (await req.json()) as ReceiptCompanyRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "unparseable JSON body" }, { status: 400 });
  }

  const receiptId = typeof body.receipt_document_id === "string" ? body.receipt_document_id.trim() : "";
  const companyId = typeof body.customer_company_id === "string" ? body.customer_company_id.trim() : "";
  const actor = typeof body.actor === "string" ? body.actor.trim() : "";
  if (!receiptId) return NextResponse.json({ ok: false, error: "receipt_document_id is required" }, { status: 400 });
  if (!companyId) return NextResponse.json({ ok: false, error: "customer_company_id is required" }, { status: 400 });
  if (!actor) return NextResponse.json({ ok: false, error: "actor is required" }, { status: 400 });

  const result = await assignReceiptCompany({
    receipt_document_id: receiptId,
    customer_company_id: companyId,
    actor,
    reason: "receipt-reconcile-sweep auto backfill (Connect identity)",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status ?? 422 });
  }
  return NextResponse.json({ ok: true, customer_company_id: result.customer_company_id, company_name: result.company_name });
}
