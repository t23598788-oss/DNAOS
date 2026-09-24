/**
 * Canonical receipt-confirm flow — ONE sequence, TWO callers
 * (LINE financial-edge removal P4 · owner decision D2 = ก, 2026-09-24).
 *
 *   manual: app/api/admin/receipt-documents/[id]/confirm (Rule 72 human click)
 *   bridge: app/api/internal/connect/payment-confirm (Autonomous Payment
 *     Confirmation owner 2026-07-24 — Deno ไปถึงได้เฉพาะผ่าน
 *     _shared/connect-payment.ts · provider tier เลิกเรียก RPC
 *     reconcile_receipt_payment โดยตรง — census บังคับ count = 0)
 *
 * Sequence = เงินก้อนเดิมของ pre-rewire manual route + receipt finalization
 * ของ legacy RPC (คงพฤติกรรมผู้สืบทอดทั้งสองไว้ครบ): อ่าน → idempotency →
 * eligibility gate (ai_read + slip/advice + company + amount · fail closed) →
 * debt snapshot (ไม่มี = legacy receipt_not_reconcilable · fail closed) →
 * resolvePaymentDocumentLink → confirmPayment (การเขียนเงินเดียว · B-04) →
 * penalty split append + ledger refresh → receipt finalization 4 fields
 * (status=confirmed · matched_debt_event_id · confirmed_by · payment_verified
 * — legacy RPC เขียนครบ 4 และผู้อ่านยังพึ่งทั้งหมด: fraud gate สลิปซ้ำ ·
 * sweep pending queue · finance evidence · feed labels) → คืน
 * already/new_outstanding ให้ caller ตัดสินใจเรื่องข้อความลูกค้า
 *
 * ไม่มีสูตรเงินใหม่ในไฟล์นี้ — split/guards/atomic commit มาจาก canonical
 * writers เดิมทั้งสิ้น
 *
 * Known deferral (flagged 2026-09-24 — ไม่แก้เงียบ): anchor debt event ภายใน
 * confirm_payment_allocation คือผลรวม anchor allocations ดังนั้นเงินที่จ่ายเกิน
 * ยอดที่ ledger track อยู่ได้ receipt_received(ทั้งหมด) +
 * interest_penalty_received(ส่วนเกิน) — แถวเดียวกับที่ manual path เขียนวันนี้
 * (legacy RPC เขียน receipt_received(principal) แทน) · ปรับให้เท่ากันต้องแตะ
 * RPC = DDL ขออนุมัติแยก — รอบนี้แค่ทำให้ auto กับ manual มี behavior เดียวกัน
 * แทนที่จะต่างกันคนละแบบ
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { confirmPayment, type ConfirmPaymentResult } from "@/engines/canonical/payment-write";
import { appendDebtEvent, refreshDebtSnapshotFromLedger } from "@/engines/canonical/debt-write";
import { resolvePaymentDocumentLink } from "@/engines/transactions/document-link";

export interface ReceiptConfirmOutcome {
  ok: boolean;
  /** legacy RPC contract: true = ไม่มีอะไรต้องทำ — receipt ถูกยืนยันไปแล้ว */
  already_reconciled: boolean;
  error?: string;
  /** สถานะปัจจุบันของ receipt เมื่อ caller ต้องใช้ในข้อความ error ตัวเอง */
  receipt_status?: string;
  receipt_document_id: string;
  /** ยอดค้างของบริษัทหลังยืนยัน (ชื่อเดิม new_outstanding ของ legacy RPC) */
  new_outstanding: number | null;
  debt_event_id: string | null;
  amount: number | null;
  payment_kind?: string;
  document?: ReturnType<typeof resolvePaymentDocumentLink>["document"];
  canonical?: ConfirmPaymentResult;
}

const PAYMENT_TYPES = ["transfer_slip", "payment_advice"];

function reject(id: string, error: string, extra: Partial<ReceiptConfirmOutcome> = {}): ReceiptConfirmOutcome {
  return {
    ok: false,
    already_reconciled: false,
    error,
    receipt_document_id: id,
    new_outstanding: null,
    debt_event_id: null,
    amount: null,
    ...extra,
  };
}

async function readOutstanding(db: ReturnType<typeof supabaseAdmin>, companyId: string | null): Promise<number | null> {
  if (!companyId) return null;
  const { data } = await db
    .from("debt_snapshots")
    .select("total_outstanding")
    .eq("customer_company_id", companyId)
    .maybeSingle();
  if (!data || data.total_outstanding === null || data.total_outstanding === undefined) return null;
  return Number(data.total_outstanding);
}

export async function confirmReceiptPayment(input: {
  receipt_document_id: string;
  actor: string;
}): Promise<ReceiptConfirmOutcome> {
  const id = input.receipt_document_id;
  const actor = input.actor?.trim() ?? "";
  if (!actor) return reject(id, "AUDIT_ACTOR_REQUIRED");
  if (!id) return reject(id, "RECEIPT_NOT_FOUND");

  const db = supabaseAdmin();
  const { data: receipt, error: receiptErr } = await db
    .from("receipt_documents")
    .select("id, document_type, status, amount, transaction_datetime, document_date, customer_company_id, reference_number, matched_debt_event_id")
    .eq("id", id)
    .maybeSingle();
  if (receiptErr || !receipt) return reject(id, "RECEIPT_NOT_FOUND");

  const companyId = (receipt.customer_company_id as string | null) ?? null;
  const amount = receipt.amount === null || receipt.amount === undefined ? null : Number(receipt.amount);

  // ── idempotency — legacy RPC's exact early-return (matched pointer OR
  //    status confirmed) + allocations-exist so a crash between the monetary
  //    commit and the finalization update converges instead of stranding the
  //    row in the sweep's pending queue forever ───────────────────────────
  const { data: existingAlloc } = await db
    .from("payment_allocations")
    .select("debt_event_id")
    .eq("receipt_document_id", id)
    .limit(1);
  const allocated = (existingAlloc ?? []).length > 0;
  if (receipt.status === "confirmed" || receipt.matched_debt_event_id || allocated) {
    const debtEventId = (receipt.matched_debt_event_id as string | null)
      ?? (allocated ? ((existingAlloc as { debt_event_id: string | null }[])[0]?.debt_event_id ?? null) : null);
    // self-healing finalization for the crash window (same 4 fields, guarded)
    if (receipt.status !== "confirmed" && debtEventId && companyId) {
      await db
        .from("receipt_documents")
        .update({
          status: "confirmed",
          matched_debt_event_id: debtEventId,
          confirmed_by: actor,
          payment_verified: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", receipt.status as string);
    }
    return {
      ok: true,
      already_reconciled: true,
      receipt_document_id: id,
      new_outstanding: await readOutstanding(db, companyId),
      debt_event_id: debtEventId,
      amount,
      receipt_status: receipt.status === "confirmed" ? "confirmed" : String(receipt.status),
    };
  }

  // ── eligibility — legacy 'receipt_not_reconcilable' + manual route's ai_read
  //    gate (rejected / waiting rows never confirm) · fail closed ──────────
  if (receipt.status !== "ai_read") {
    return reject(id, "RECEIPT_NOT_ELIGIBLE", { receipt_status: String(receipt.status) });
  }
  if (!PAYMENT_TYPES.includes(String(receipt.document_type))) {
    return reject(id, "RECEIPT_WRONG_TYPE", { receipt_status: String(receipt.status) });
  }
  if (!companyId) return reject(id, "RECEIPT_NO_COMPANY", { receipt_status: String(receipt.status) });
  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    return reject(id, "RECEIPT_NO_AMOUNT", { receipt_status: String(receipt.status) });
  }

  // ── debt snapshot (legacy debt_snapshot_not_found → caller ปล่อย slip
  //    ค้าง Pending Review ให้คนจัดการ — ไม่มี snapshot จริง = ห้ามเดา) ───
  const outstandingBefore = await readOutstanding(db, companyId);
  if (outstandingBefore === null) return reject(id, "DEBT_SNAPSHOT_NOT_FOUND");

  const { data: company } = await db.from("companies").select("name").eq("id", companyId).maybeSingle();
  const occurredAt = String(receipt.transaction_datetime ?? receipt.document_date ?? new Date().toISOString()).slice(0, 10);
  const link = resolvePaymentDocumentLink({
    amount,
    transactionOutstanding: outstandingBefore,
    transactionId: companyId,
    partnerName: (company?.name as string | null) ?? undefined,
    reference: (receipt.reference_number as string | null) ?? undefined,
  });

  // ── split — same arithmetic as both predecessors (principal vs interest) ─
  const principalPortion = Math.min(amount, outstandingBefore);
  const interestPenaltyPortion = Math.round((amount - principalPortion) * 100) / 100;

  // ── the ONE monetary commit (B-04: guards + atomic confirm_payment_allocation)
  let canonical: ConfirmPaymentResult;
  try {
    canonical = await confirmPayment({
      receipt_document_id: id,
      allocations: [
        {
          target: { kind: "anchor" },
          allocation_kind: "principal",
          amount: principalPortion,
          note: link.document.note ?? null,
        },
        ...(interestPenaltyPortion > 0
          ? [
              {
                target: { kind: "anchor" as const },
                allocation_kind: "penalty" as const,
                amount: interestPenaltyPortion,
                note: `ดอกเบี้ย/ค่าปรับที่ได้รับพร้อมเงินต้น (สลิป ${receipt.reference_number ?? id})`,
              },
            ]
          : []),
      ],
      actor,
      debt_event_anchor: {
        event_type: "receipt_received",
        amount: principalPortion,
        note: link.document.note ?? null,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "confirmPayment failed";
    // race เข้าไม่ทัน idempotency ข้างบน — คืน already (legacy contract)
    if (/PAYMENT_ALREADY_ALLOCATED/.test(message)) {
      return {
        ok: true,
        already_reconciled: true,
        receipt_document_id: id,
        new_outstanding: await readOutstanding(db, companyId),
        debt_event_id: null,
        amount,
        receipt_status: String(receipt.status),
      };
    }
    return reject(id, message, { receipt_status: String(receipt.status) });
  }

  // ── penalty attribution + ledger refresh (pre-rewire manual route) ──────
  if (interestPenaltyPortion > 0) {
    await appendDebtEvent({
      customer_company_id: companyId,
      event_type: "interest_penalty_received",
      amount: interestPenaltyPortion,
      occurred_at: occurredAt,
      note: `ดอกเบี้ย/ค่าปรับที่ได้รับพร้อมเงินต้น (สลิป ${receipt.reference_number ?? id}, ยอดรวมที่โอนมาจริง ${amount.toLocaleString("th-TH")} บาท)`,
      source: "line_chat",
      actor,
      evidence: { receipt_document_id: id },
    });
    await refreshDebtSnapshotFromLedger(companyId, actor);
  }

  // ── receipt finalization — legacy RPC's exact 4 fields (readers below) ──
  const { error: finalizeErr } = await db
    .from("receipt_documents")
    .update({
      status: "confirmed",
      matched_debt_event_id: canonical.debt_event_id,
      confirmed_by: actor,
      payment_verified: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (finalizeErr) {
    return reject(id, `RECEIPT_FINALIZE_FAILED:${finalizeErr.message}`, { receipt_status: String(receipt.status) });
  }

  return {
    ok: true,
    already_reconciled: false,
    receipt_document_id: id,
    new_outstanding: await readOutstanding(db, companyId),
    debt_event_id: canonical.debt_event_id,
    amount,
    payment_kind: link.kind,
    document: link.document,
    canonical,
    receipt_status: "confirmed",
  };
}

