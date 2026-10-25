/**
 * Receipt debtor assignment — the ONE authorized write path for
 * receipt_documents.customer_company_id (BATCH 33 · BOM-070 2026-10-14).
 *
 * Both the manual admin route (app/api/admin/receipt-documents/[id]/company)
 * and the internal Connect bridge (app/api/internal/connect/receipt-company)
 * call this function — neither route writes receipt_documents directly, so
 * there is exactly one write site (here) and no parallel writer.
 *
 * This is a metadata assignment (which company a pending receipt belongs to),
 * NOT a money write — the payment RPC / receipt-confirm-flow are untouched;
 * after assignment the existing confirm flow works unchanged.
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { recordCanonicalAudit } from "@/engines/canonical/audit";

export interface AssignReceiptCompanyInput {
  receipt_document_id: string;
  customer_company_id: string;
  actor: string;
  reason: string;
}

export interface AssignReceiptCompanyResult {
  ok: boolean;
  error?: string;
  code?: "RECEIPT_NOT_FOUND" | "RECEIPT_NOT_ASSIGNABLE" | "COMPANY_NOT_FOUND";
  status?: number;
  customer_company_id?: string;
  company_name?: string;
}

export async function assignReceiptCompany(input: AssignReceiptCompanyInput): Promise<AssignReceiptCompanyResult> {
  const db = supabaseAdmin();

  const { data: receipt, error: rErr } = await db
    .from("receipt_documents")
    .select("id, status, customer_company_id, amount")
    .eq("id", input.receipt_document_id)
    .maybeSingle();
  if (rErr || !receipt) {
    return { ok: false, code: "RECEIPT_NOT_FOUND", error: rErr?.message ?? "ไม่พบสลิปรายการนี้", status: 404 };
  }
  if (receipt.status !== "ai_read") {
    return { ok: false, code: "RECEIPT_NOT_ASSIGNABLE", error: `แก้คู่ค้าได้เฉพาะสลิปที่ยังรอตรวจสอบ (ai_read) — สถานะปัจจุบัน: ${receipt.status}`, status: 409 };
  }

  const { data: company } = await db.from("companies").select("id, name").eq("id", input.customer_company_id).maybeSingle();
  if (!company) {
    return { ok: false, code: "COMPANY_NOT_FOUND", error: "ไม่พบบริษัท/บุคคลนี้ในทะเบียน — เลือกจากรายการที่มีอยู่เท่านั้น", status: 400 };
  }

  const { error: upErr } = await db
    .from("receipt_documents")
    .update({ customer_company_id: input.customer_company_id, updated_at: new Date().toISOString() })
    .eq("id", input.receipt_document_id);
  if (upErr) return { ok: false, error: upErr.message, status: 500 };

  await recordCanonicalAudit({
    action: "document.updated",
    entity_type: "receipt_document",
    entity_id: input.receipt_document_id,
    actor: input.actor,
    field: "customer_company_id",
    old_value: receipt.customer_company_id ?? null,
    new_value: input.customer_company_id,
    evidence: {
      reason: input.reason,
      assigned_by: input.actor,
      receipt_status: receipt.status,
      amount: receipt.amount,
    },
  });

  return { ok: true, customer_company_id: input.customer_company_id, company_name: company.name };
}
