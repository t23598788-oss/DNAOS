// Connect receipt debtor-assignment transport (BOM-070 FINAL HARDENING ·
// owner approved 2026-10-14) — the provider tier's ONLY path to backfill
// receipt_documents.customer_company_id (auto Connect identity match).
//
// It knows only { receipt_document_id, customer_company_id, actor } and knows
// nothing else: no table columns, no money, no fallback — missing env/secret,
// non-2xx, or writer rejection all return { ok: false } and the caller leaves
// the slip Pending Review (fail closed), identical to connect-payment/connect-inbound.
//
// env (two-sided — missing either side = fail closed):
//   Deno: DNA_OS_APP_URL + RECEIPT_COMPANY_INTERNAL_SECRET (supabase secrets)
//   Next: RECEIPT_COMPANY_INTERNAL_SECRET (.env / Vercel)

export interface ConnectReceiptCompanyResult {
  ok: boolean;
  error?: string;
  data?: { customer_company_id: string; company_name: string };
}

export async function sendConnectReceiptCompany(
  receiptDocumentId: string,
  customerCompanyId: string,
  actor: string,
): Promise<ConnectReceiptCompanyResult> {
  const appUrl = Deno.env.get("DNA_OS_APP_URL");
  const secret = Deno.env.get("RECEIPT_COMPANY_INTERNAL_SECRET");
  if (!appUrl || !secret) {
    return { ok: false, error: "RECEIPT_COMPANY_CONNECT_TRANSPORT_NOT_CONFIGURED" };
  }

  try {
    const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/internal/connect/receipt-company`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-receipt-company-internal-secret": secret },
      body: JSON.stringify({ receipt_document_id: receiptDocumentId, customer_company_id: customerCompanyId, actor }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as ConnectReceiptCompanyResult;
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `RECEIPT_COMPANY_CONNECT_TRANSPORT_HTTP_${res.status}` };
    }
    return { ok: true, data: body.data };
  } catch (err) {
    return { ok: false, error: `RECEIPT_COMPANY_CONNECT_TRANSPORT_FAILED:${err instanceof Error ? err.message : String(err)}` };
  }
}
