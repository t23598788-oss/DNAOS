/**
 * Payment acknowledgement (BATCH 40 — owner 2026-10-08).
 *
 * After a payment is confirmed: SELECT or CREATE the canonical receipt document
 * (standalone_documents, document_type "receipt"), build the account summary
 * from the LEDGER view (company_debt_current — never from invoice AR), push it
 * to the customer's LINE channel, and record delivery evidence.
 *
 *   select-or-create receipt doc → ledger summary → LINE push (single gateway)
 *     → line_events direction "out" evidence (BATCH 38 shape: recipient ·
 *       sent_at=created_at · provider message id · status · document ref +
 *       receipt_document_id for idempotency) → recordCanonicalAudit
 *
 * Design rules:
 *   · Recipient comes from the CANONICAL identity (connect_external_identities,
 *     batch 28/37) with company_line_links only as the legacy fallback — never
 *     an internal forwarding account (those carry no company identity).
 *   · Idempotent: an existing direction-out evidence row carrying this
 *     receipt_document_id short-circuits (already_acknowledged).
 *   · Non-fatal for callers: returns { ok:false, error } instead of throwing —
 *     a failed acknowledgement must never roll back or fail the payment.
 *   · Money writes: createDocument is the ONLY writer used (canonical
 *     document authority) — this module never inserts documents itself.
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { createDocument } from "@/engines/canonical/document-write";
import { recordCanonicalAudit } from "@/engines/canonical/audit";
import { storeDocumentArtifacts, lineDocumentMessages } from "@/gateway/document-artifact-storage";
import { loadCompanySettings } from "@/core/config/company-settings";
import { sendLineMessage } from "@/registry/communication";

export interface AckSummary {
  /** ledger outstanding (company_debt_current.ledger_outstanding) */
  outstanding: number;
  collection_state: string;
  days_overdue: number;
  text: string;
}

export interface AcknowledgeResult {
  ok: boolean;
  error?: string;
  code?:
    | "RECEIPT_NOT_FOUND"
    | "RECEIPT_NOT_CONFIRMED"
    | "ACK_NO_COMPANY"
    | "ACK_NO_LINE_RECIPIENT"
    | "ACK_DOC_CREATE_FAILED"
    | "ACK_SEND_FAILED";
  already_acknowledged?: boolean;
  ack_document_id?: string | null;
  ack_document_no?: string | null;
  recipient?: string | null;
  delivered?: boolean;
  provider_message_id?: string | null;
  summary?: AckSummary;
  /** artifact ที่สร้าง/เก็บสำเร็จ (PNG+PDF ใน generated-documents/) */
  artifact?: { image_path: string; pdf_path: string } | null;
  /**
   * Artifact generation/storage failure (owner mission 2026-10-10, ARTIFACT
   * RECOVERY §2): เดิม error นี้ถูกกลืนเงียบแล้ว ack ลดเป็นข้อความล้วน —
   * ห้ามเงียบอีกต่อไป: บันทึก audit + console.error + คืนค่าให้ caller เห็น
   * (การ ack ยังคง non-fatal ต่อ payment เหมือนเดิม — แต่ไม่ใช่ silent)
   */
  artifact_error?: string | null;
}

const fmt = (n: number) =>
  Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function summaryText(ledger: { outstanding: number; state: string; days: number }): AckSummary {
  const o = ledger.outstanding;
  let line: string;
  if (o > 0) {
    line = `คงเหลือ ${fmt(o)} บาท${ledger.days > 0 ? ` (ค้าง ${ledger.days} วัน)` : ""}`;
  } else if (o < 0) {
    line = `เครดิตลูกค้า ${fmt(Math.abs(o))} บาท (ชำระเกิน) — ปิดบัญชีแล้ว`;
  } else {
    line = "ยอดคงเหลือ 0.00 บาท — ปิดบัญชีแล้ว";
  }
  return {
    outstanding: o,
    collection_state: ledger.state,
    days_overdue: ledger.days,
    text: `📊 สรุปบัญชี (จาก ledger): ${line} | สถานะ ${ledger.state}`,
  };
}

async function resolveRecipient(db: ReturnType<typeof supabaseAdmin>, companyId: string): Promise<string | null> {
  // canonical identity first (batch 28/37), legacy projection as fallback
  const { data: identity } = await db
    .from("connect_external_identities")
    .select("external_subject_id")
    .eq("provider", "line")
    .eq("company_id", companyId)
    .limit(1)
    .maybeSingle();
  if (identity?.external_subject_id) return String(identity.external_subject_id);
  const { data: link } = await db
    .from("company_line_links")
    .select("line_user_id")
    .eq("company_id", companyId)
    .limit(1)
    .maybeSingle();
  return link?.line_user_id ? String(link.line_user_id) : null;
}

/**
 * The acknowledgement pipeline for one confirmed receipt. NEVER throws —
 * every failure mode comes back as { ok:false, code } so the payment flow
 * stays unaffected.
 */
export async function acknowledgePayment(input: {
  receipt_document_id: string;
  actor: string;
}): Promise<AcknowledgeResult> {
  const db = supabaseAdmin();

  const { data: receipt } = await db
    .from("receipt_documents")
    .select("id, status, document_type, amount, reference_number, sender_name, customer_company_id, matched_debt_event_id, document_date, transaction_datetime")
    .eq("id", input.receipt_document_id)
    .maybeSingle();
  if (!receipt) return { ok: false, code: "RECEIPT_NOT_FOUND", error: "ไม่พบเอกสารใบรับเงิน" };
  if (receipt.status !== "confirmed") {
    return { ok: false, code: "RECEIPT_NOT_CONFIRMED", error: `ยืนยันรับเงินก่อน (สถานะปัจจุบัน: ${receipt.status})` };
  }
  const companyId = receipt.customer_company_id ? String(receipt.customer_company_id) : null;
  if (!companyId) return { ok: false, code: "ACK_NO_COMPANY", error: "สลิปนี้ยังไม่มีคู่ค้า/ผู้เป็นหนี้" };

  // ── idempotency: an out-evidence row already carries this receipt ───────────
  const { data: outRows } = await db
    .from("line_events")
    .select("id, extracted")
    .eq("direction", "out")
    .not("extracted", "is", null)
    .limit(500);
  const existingEvidence = (outRows ?? []).find(
    (r) => ((r.extracted as Record<string, unknown> | null)?.receipt_document_id ?? null) === input.receipt_document_id,
  );
  if (existingEvidence) {
    return { ok: true, already_acknowledged: true, delivered: true };
  }

  const recipient = await resolveRecipient(db, companyId);
  if (!recipient) return { ok: false, code: "ACK_NO_LINE_RECIPIENT", error: "ลูกค้ารายนี้ยังไม่ได้เชื่อมบัญชี LINE" };

  const { data: company } = await db.from("companies").select("name").eq("id", companyId).maybeSingle();
  const companyName = (company?.name as string) ?? "ลูกค้า";

  // ── account summary: LEDGER view only (invoice AR is a different ledger) ────
  const { data: debtRow } = await db
    .from("company_debt_current")
    .select("ledger_outstanding, snapshot_collection_state, snapshot_days_overdue")
    .eq("company_id", companyId)
    .maybeSingle();
  const summary = summaryText({
    outstanding: Number(debtRow?.ledger_outstanding ?? 0),
    state: String(debtRow?.snapshot_collection_state ?? "UNKNOWN"),
    days: Number(debtRow?.snapshot_days_overdue ?? 0),
  });

  const amount = Number(receipt.amount ?? 0);
  const ref = receipt.reference_number ? String(receipt.reference_number) : "";
  const receiptDate = String(receipt.document_date ?? receipt.transaction_datetime ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);


  // ── SELECT or CREATE the canonical receipt document ─────────────────────────
  const marker = `receipt_document:${input.receipt_document_id}`;
  const { data: candidates } = await db
    .from("standalone_documents")
    .select("id, document_no, document_date, reference_no, total_amount, notes, status")
    .eq("customer_company_id", companyId)
    .eq("document_type", "receipt")
    .order("created_at", { ascending: false })
    .limit(200);
  let ackDoc: { id: string; document_no?: string | null } | null =
    (candidates ?? []).find((d) => String(d.notes ?? "").includes(marker)) ?? null;
  // Legacy receipt docs (mission 2026-10-10): receipts issued 2026-08-05 from
  // confirmed payments carry their debt_events marker in notes instead of the
  // receipt_document marker above. Matching on the receipt's OWN
  // matched_debt_event_id is 1:1, so this reuses the existing document instead
  // of creating a duplicate REC for a payment that already has one.
  if (!ackDoc && receipt.matched_debt_event_id) {
    const debtMarker = `debt_events ${receipt.matched_debt_event_id}`;
    ackDoc =
      (candidates ?? []).find((d) => String(d.notes ?? "").includes(debtMarker)) ?? null;
  }
  if (!ackDoc && ref) {
    ackDoc =
      (candidates ?? []).find(
        (d) =>
          String(d.reference_no ?? "") === ref &&
          Number(d.total_amount ?? -1) === amount &&
          String(d.document_date ?? "").slice(0, 10) === receiptDate,
      ) ?? null;
  }

  if (!ackDoc) {
    const docNo = `REC-${receiptDate.replace(/-/g, "")}-${String(Date.now()).slice(-3)}`;
    const description = `รับชำระ ${fmt(amount)} บาท${ref ? ` (สลิป ${ref})` : ""}${receipt.sender_name ? ` จาก ${receipt.sender_name}` : ""} — ${companyName}`;
    try {
      const created = await createDocument({
        kind: "standalone_document",
        document_no: docNo,
        document_type: "receipt",
        customer_company_id: companyId,
        customer_order_id: null,
        issue_date: receiptDate,
        reference_no: ref || null,
        notes: marker,
        rows: [{ qty: 1, unitPrice: amount }],
        vatEnabled: false,
        items: [{ description, qty: 1, unit: "รายการ", unit_price: amount, sort_order: 0 }],
        actor: input.actor,
        status: "active",
      });
      ackDoc = { id: created.document_id, document_no: created.document_no };
    } catch (e) {
      return { ok: false, code: "ACK_DOC_CREATE_FAILED", error: e instanceof Error ? e.message : "สร้างใบรับเงินไม่สำเร็จ" };
    }
  }
  const ackId = String(ackDoc.id);
  const ackNo = String(ackDoc.document_no ?? "");

  // ── message: receipt artifact + summary, text-only fallback ─────────────────
  const ackHead = `🧾 ใบรับเงิน ${ackNo}\nรับชำระ ${fmt(amount)} บาท${ref ? `\nสลิปอ้างอิง: ${ref}` : ""}\nคู่ค้า: ${companyName}`;
  let messages: Array<Record<string, unknown>>;
  let artifact: { image_path: string; pdf_path: string } | null = null;
  let artifactError: string | null = null;
  try {
    const settings = await loadCompanySettings();
    const artifacts = await storeDocumentArtifacts(ackId, {
      type: "receipt",
      docNumber: ackNo,
      date: receiptDate,
      status: "ชำระแล้ว",
      company: { name: settings.companyName, taxId: settings.companyTaxId },
      customer: { name: companyName },
      items: [{ description: `รับชำระ ${fmt(amount)} บาท${ref ? ` (สลิป ${ref})` : ""}`, qty: 1, unit: "รายการ", unitPrice: amount }],
      precomputedSummary: { subtotal: amount, vatRate: 0, vat: 0, total: amount },
    });
    artifact = { image_path: artifacts.imagePath, pdf_path: artifacts.pdfPath };
    messages = [...lineDocumentMessages(artifacts, `ใบรับเงิน ${ackNo}`), { type: "text", text: `${ackHead}\n${summary.text}` }];
  } catch (e) {
    // NO SILENT ARTIFACT FAILURE (owner 2026-10-10, ARTIFACT RECOVERY §2): ack
    // ยังส่งต่อแบบข้อความ (non-fatal ต่อ payment เหมือนเดิม) แต่ failure ต้อง
    // ถูกบันทึก (audit) + รายงาน (console.error + artifact_error ในผลลัพธ์)
    artifactError = e instanceof Error ? e.message : String(e);
    console.error("[payment-acknowledgement] artifact generation failed — acknowledged with text-only message:", artifactError);
    try {
      await recordCanonicalAudit({
        action: "artifact.failed",
        entity_type: "receipt_document",
        entity_id: input.receipt_document_id,
        actor: input.actor,
        new_value: { stage: "render_or_store", ack_document_id: ackId, error: artifactError },
      });
    } catch {
      /* audit ที่ล้มเหลวห้ามทำให้ payment พัง — console.error ด้านบนคือหลักฐานแล้ว */
    }
    messages = [{ type: "text", text: `${ackHead}\n${summary.text}` }];
  }

  const lineRes = await sendLineMessage(db, recipient, messages as never[]);
  if (!lineRes.success) {
    return { ok: false, code: "ACK_SEND_FAILED", error: (lineRes.error ?? "LINE push failed").slice(0, 200) };
  }

  // ── delivery evidence (BATCH 38 shape) + canonical audit ────────────────────
  await db.from("line_events").insert({
    line_user_id: recipient,
    raw_type: "flex",
    raw_text: `🧾 ใบรับเงิน ${ackNo} · รับชำระ ${fmt(amount)} บาท · ส่งให้ลูกค้าแล้ว`,
    status: "processed",
    direction: "out",
    line_message_id: lineRes.messageId ?? null,
    extracted: {
      document_kind: "receipt",
      document_id: ackId,
      document_no: ackNo,
      provider: "line",
      receipt_document_id: input.receipt_document_id,
      amount,
      outstanding: summary.outstanding,
    },
  });

  await recordCanonicalAudit({
    action: "receipt.acknowledged",
    entity_type: "receipt_document",
    entity_id: input.receipt_document_id,
    actor: input.actor,
    company_id: companyId,
    new_value: { ack_document_id: ackId, ack_document_no: ackNo, recipient, outstanding: summary.outstanding },
    evidence: { provider: "line", provider_message_id: lineRes.messageId ?? null, amount, reference: ref || null },
  });

  return {
    ok: true,
    ack_document_id: ackId,
    ack_document_no: ackNo,
    recipient,
    delivered: true,
    provider_message_id: lineRes.messageId ?? null,
    summary,
    artifact,
    artifact_error: artifactError,
  };
}

