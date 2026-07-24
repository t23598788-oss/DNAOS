import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { dispatchAction, sendInvoiceToLine } from "@/gateway/actions";
import { supabaseAdmin as supabase } from "@/services/supabase/queries";
import { documentFlex } from "@/engines/documents/flex-template";
import { DOC_LABELS, type DocType } from "@/engines/documents/engine";
import { loadCompanySettings } from "@/core/config/company-settings";
import { sendLineMessage } from "@/registry/communication";

// Rule 72 confirm step for the chat secretary — the preview_token already
// carries the full payload from when cognitive/executor/index.ts called
// previewDocumentCreate(), so this goes straight to dispatchAction's execute
// mode (ConfirmInvoice, for document_type "invoice") instead of re-running
// the whole cognitive pipeline.
//
// Invoice Workflow Redesign (owner, 2026-07-17): ConfirmInvoice and
// SendInvoiceToLINE are separate capabilities, called sequentially, never
// fused — explicit owner instruction. If ConfirmInvoice (the dispatchAction
// call below) fails, SendInvoiceToLINE is never attempted. If the LINE push
// fails, the invoice stays saved (status untouched) and can be retried later
// via POST /api/admin/invoices/[invoiceId]/send without recreating anything.
// Non-invoice document types (quotation/boq/receipt/etc.) keep the older,
// simpler inline send below — unchanged, out of scope for this redesign.
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { action, preview_token, lineUserId } = await request.json();
  if (!action || !preview_token) {
    return NextResponse.json({ ok: false, error: "ขาด action หรือ preview_token" }, { status: 400 });
  }

  const result = await dispatchAction({ action, mode: "execute", payload: {}, preview_token });
  let lineSendError: string | undefined;

  if (!result.ok || action !== "document.create") {
    return NextResponse.json({ ...result, line_send_error: lineSendError });
  }

  const doc = result.result as {
    id?: string; document_type: DocType; document_number: string; party_name: string;
    items: { description: string; qty: number; unit: string; unitPrice: number; discount?: number }[];
    summary: { subtotal: number; vat: number; total: number };
  } | undefined;
  if (!doc) return NextResponse.json({ ...result, line_send_error: lineSendError });

  if (doc.document_type === "invoice") {
    // SendInvoiceToLINE — Step 4, only reached because ConfirmInvoice
    // (above) already succeeded. Re-loads the SAVED invoice+items itself;
    // does not trust anything from the ConfirmInvoice result object.
    if (doc.id) {
      const sendResult = await sendInvoiceToLine(doc.id);
      if (!sendResult.ok) lineSendError = sendResult.error;
    }
    return NextResponse.json({ ...result, line_send_error: lineSendError });
  }

  // Non-invoice documents — unchanged inline send (out of scope here).
  if (typeof lineUserId === "string" && lineUserId) {
    const company = await loadCompanySettings();
    const flex = documentFlex({
      documentType: doc.document_type,
      documentNumber: doc.document_number,
      partyName: doc.party_name,
      items: doc.items,
      summary: doc.summary,
      branding: {
        ourCompanyName: company.companyName || undefined,
        ourCompanyTaxId: company.companyTaxId || undefined,
        terms: company.documentTerms || undefined,
        footerNote: company.documentFooterNote || undefined,
      },
    });
    const label = DOC_LABELS[doc.document_type]?.th ?? doc.document_type;

    const lineRes = await sendLineMessage(lineUserId, [
      { type: "flex", altText: `${label} ${doc.document_number}`, contents: flex },
    ]);

    const db = supabase();
    if (lineRes.success) {
      await db.from("line_events").insert({
        line_user_id: lineUserId,
        raw_type: "flex",
        raw_text: `📄 ${label} ${doc.document_number} ส่งให้ลูกค้าแล้ว`,
        status: "processed",
        direction: "out",
        // Owner request 2026-07-24: admin control room must show the EXACT
        // card the customer received, not a paraphrased summary.
        extracted: { flex },
      });
    } else {
      lineSendError = `ส่ง LINE ไม่สำเร็จ: ${(lineRes.error ?? "").slice(0, 200)}`;
    }
  }

  return NextResponse.json({ ...result, line_send_error: lineSendError });
}
