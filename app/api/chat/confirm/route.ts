import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { dispatchAction } from "@/gateway/actions";
import { supabaseAdmin as supabase } from "@/services/supabase/queries";
import { documentFlex } from "@/engines/documents/flex-template";
import { DOC_LABELS, type DocType } from "@/engines/documents/engine";
import { loadCompanySettings } from "@/core/config/company-settings";

// Rule 72 confirm step for the chat secretary — the preview_token already
// carries the full payload from when cognitive/executor/index.ts called
// previewDocumentCreate(), so this goes straight to dispatchAction's execute
// mode instead of re-running the whole cognitive pipeline.
//
// Owner request 2026-07-11: close the "one click, done" loop — a confirmed
// document.create used to just write the row and stop (the workflow's
// line.send step, defined in cognitive/pipeline.ts, was never actually
// reached from this path). If lineUserId is supplied (the admin confirmed
// from a specific LINE contact's chat), push a real Flex Message card built
// from the real saved document, and log it so it shows in the real thread.
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { action, preview_token, lineUserId } = await request.json();
  if (!action || !preview_token) {
    return NextResponse.json({ ok: false, error: "ขาด action หรือ preview_token" }, { status: 400 });
  }

  const result = await dispatchAction({ action, mode: "execute", payload: {}, preview_token });
  let lineSendError: string | undefined;

  if (result.ok && action === "document.create" && typeof lineUserId === "string" && lineUserId) {
    const doc = result.result as {
      document_type: DocType; document_number: string; party_name: string;
      items: { description: string; qty: number; unit: string; unitPrice: number; discount?: number }[];
      summary: { subtotal: number; vat: number; total: number };
    } | undefined;

    if (doc) {
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
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

      if (token) {
        const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ to: lineUserId, messages: [{ type: "flex", altText: `${label} ${doc.document_number}`, contents: flex }] }),
        });

        const db = supabase();
        if (lineRes.ok) {
          await db.from("line_events").insert({
            line_user_id: lineUserId,
            raw_type: "flex",
            raw_text: `📄 ${label} ${doc.document_number} ส่งให้ลูกค้าแล้ว`,
            status: "processed",
            direction: "out",
          });
        } else {
          // Document is already saved — a failed LINE push is a soft
          // warning, not a reason to report the whole confirm as failed.
          lineSendError = `ส่ง LINE ไม่สำเร็จ: ${(await lineRes.text()).slice(0, 200)}`;
        }
      }
    }
  }

  return NextResponse.json({ ...result, line_send_error: lineSendError });
}
