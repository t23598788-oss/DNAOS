// Infrastructure fix (owner, 2026-07-17): was `supabase` — the shared
// anon-key client (services/supabase/queries.ts), a bare singleton with no
// session ever attached. Every table this gateway writes to (invoices,
// invoice_items, standalone_documents, debt_snapshots, payments) has a
// service_role_only RLS policy (`for all using (false)`), so every write in
// this file was being rejected — confirmed empirically: a real anon-key
// INSERT into invoices returns 42501 "new row violates row-level security
// policy". This gateway is the DNA OS execution/write door, reached only
// through the preview→token→execute pattern from trusted server code
// (Rule 72) — never client-side — so supabaseAdmin() is correct here, same
// as every admin API route already uses (`supabaseAdmin as supabase`).
import { supabaseAdmin as supabase } from "@/services/supabase/queries";
import { DOC_LABELS, generateDoc, type DocData, type DocItem, type DocType } from "@/engines/documents/engine";
import { issueDocument, createDocument } from "@/engines/canonical/document-write";
import { documentFlex } from "@/engines/documents/flex-template";
import { loadCompanySettings } from "@/core/config/company-settings";
import { randomUUID } from "crypto";
import { sendLineMessage } from "@/registry/communication";
import { confirmPayment } from "@/engines/canonical/payment-write";

// ---- Types ----

export interface ActionRequest {
  action: string;
  mode: "preview" | "execute";
  payload: Record<string, unknown>;
  preview_token?: string;
  /** server context only: requireAuth → auth.email. Never taken from the request body. */
  actor?: string;
}

export interface ActionResponse {
  ok: boolean;
  mode: "preview" | "execute";
  action: string;
  preview?: Record<string, unknown>;
  preview_token?: string;
  result?: Record<string, unknown>;
  next_actions?: string[];
  error?: string;
}

// ---- PREVIEW TOKEN GUARD ----

const _tokenStore = new Map<string, { action: string; payload: Record<string, unknown>; expires: number }>();

function issueToken(action: string, payload: Record<string, unknown>): string {
  const token = randomUUID();
  _tokenStore.set(token, { action, payload, expires: Date.now() + 5 * 60 * 1000 });
  return token;
}

function consumeToken(token: string, action: string): { valid: boolean; error?: string; payload?: Record<string, unknown> } {
  const entry = _tokenStore.get(token);
  if (!entry) return { valid: false, error: "preview_token ไม่ถูกต้องหรือหมดอายุ — ต้อง preview ก่อน" };
  if (entry.action !== action) return { valid: false, error: `token ออกให้ action "${entry.action}" ไม่ใช่ "${action}"` };
  if (Date.now() > entry.expires) {
    _tokenStore.delete(token);
    return { valid: false, error: "preview_token หมดอายุ (5 นาที) — preview ใหม่" };
  }
  _tokenStore.delete(token);
  return { valid: true, payload: entry.payload };
}

// ---- PAYMENT (canonical, B-04C) ----
//
// This gateway used to be its own payment system: it read `invoice_debts`, inserted
// `invoice_payments` and updated `invoice_debts` itself. Both tables do not exist in
// the live schema, so the path could never work, and the token it issued carried only
// an invoice_debt_id with no amount at all.
//
// It is now only an ENTRY POINT into the canonical payment path:
//
//   gateway action → canonical input (receipt + deterministic invoice relation)
//                  → engines/canonical/payment-write.ts#confirmPayment
//                  → confirm_payment_allocation RPC (single transaction)
//                  → payment_allocations → invoice_payment_summary → company debt projection
//
// No monetary row is written here, no legacy fallback exists, and nothing about money
// is taken from the caller: the amount is the receipt's persisted amount, the invoice
// comes from an explicit id or the deterministic inbound_source_links relation (never
// guessed from company/amount/date), and the actor always comes from the server context.

export interface PaymentInput {
  /** the money evidence: a real receipt_documents row */
  receipt_document_id: string;
  /** optional explicit allocation target; when absent the deterministic relation is used */
  invoice_id?: string | null;
}

interface PaymentFacts {
  receipt_document_id: string;
  invoice_id: string;
  invoice_no: string;
  company_name: string;
  amount: number;
  paid_amount: number;
  outstanding: number;
  derived_status: string;
}

/** Deterministic receipt → invoice relation: the inbound_source_links SOURCE edge. */
async function resolveReceiptInvoiceRelation(receiptDocumentId: string): Promise<{ invoiceId: string | null; error?: string }> {
  const { data, error } = await supabase()
    .from("inbound_source_links")
    .select("invoice_id")
    .eq("receipt_document_id", receiptDocumentId)
    .eq("relation_type", "SOURCE")
    .not("invoice_id", "is", null);
  if (error) return { invoiceId: null, error: `อ่าน deterministic relation ไม่สำเร็จ: ${error.message}` };
  const ids = [...new Set((data ?? []).map((r) => String((r as { invoice_id: string }).invoice_id)))];
  if (ids.length === 0) return { invoiceId: null, error: "ไม่มี deterministic relation จาก receipt นี้ไป invoice (inbound_source_links) — ต้องระบุ allocation อย่างชัดเจน ห้ามเดา" };
  if (ids.length > 1) return { invoiceId: null, error: `receipt นี้ผูกหลาย invoice (${ids.length}) — ต้องระบุ allocation อย่างชัดเจน` };
  return { invoiceId: ids[0] };
}

/** Reads every fact from canonical sources and applies the fail-fast money guards. */
async function resolvePaymentFacts(input: PaymentInput): Promise<{ ok: true; facts: PaymentFacts } | { ok: false; error: string }> {
  if (!input.receipt_document_id) {
    return { ok: false, error: "ต้องระบุ receipt_document_id (หลักฐานการรับเงิน)" };
  }
  const db = supabase();
  const { data: receipt, error: receiptErr } = await db
    .from("receipt_documents")
    .select("id, document_type, status, amount, customer_company_id, allocation_state, reference_number")
    .eq("id", input.receipt_document_id)
    .maybeSingle();
  if (receiptErr || !receipt) return { ok: false, error: receiptErr?.message ?? "ไม่พบหลักฐานการรับเงิน (receipt_documents)" };
  if (!["transfer_slip", "payment_advice"].includes(String(receipt.document_type))) {
    return { ok: false, error: `เอกสารนี้ไม่ใช่หลักฐานการจ่าย (document_type=${receipt.document_type})` };
  }
  if (!receipt.amount || Number(receipt.amount) <= 0) return { ok: false, error: "receipt ไม่มียอดเงิน (canonical amount)" };

  const { data: allocated } = await db.from("payment_allocations").select("id").eq("receipt_document_id", input.receipt_document_id);
  if ((allocated ?? []).length > 0) return { ok: false, error: "สลิปนี้ถูกจัดสรรแล้ว — ห้ามลงเงินซ้ำ" };

  let invoiceId = input.invoice_id ?? null;
  if (!invoiceId) {
    const relation = await resolveReceiptInvoiceRelation(input.receipt_document_id);
    if (!relation.invoiceId) return { ok: false, error: relation.error ?? "ระบุ invoice ไม่ได้" };
    invoiceId = relation.invoiceId;
  }

  const { data: summary } = await db
    .from("invoice_payment_summary")
    .select("invoice_id, invoice_no, paid_amount, outstanding, derived_status")
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  const { data: invoice } = await db.from("invoices").select("id, customer_company_id, invoice_status").eq("id", invoiceId).maybeSingle();
  if (!summary || !invoice) return { ok: false, error: "ไม่พบใบแจ้งหนี้ใน canonical read (invoice_payment_summary/invoices)" };
  if (String(invoice.invoice_status) === "VOID") return { ok: false, error: "ห้ามจัดสรรเงินเข้าใบแจ้งหนี้ที่ถูกยกเลิก (VOID)" };
  if (!receipt.customer_company_id || String(invoice.customer_company_id) !== String(receipt.customer_company_id)) {
    return { ok: false, error: "บริษัทของ receipt ไม่ตรงกับบริษัทของ invoice" };
  }

  const amount = Number(receipt.amount);
  const outstanding = Number(summary.outstanding ?? 0);
  // single-invoice gateway path: the whole receipt must fit. A larger slip needs an
  // explicit allocation instruction for the remainder, which this path does not accept.
  if (amount > outstanding) {
    return { ok: false, error: `ยอด receipt ${amount} เกินยอดคงค้าง ${outstanding} — ต้องมีคำสั่งจัดสรรส่วนที่เหลืออย่างชัดเจน (ห้าม clamp/ห้ามเดา)` };
  }

  const { data: company } = await db.from("companies").select("name").eq("id", String(invoice.customer_company_id)).maybeSingle();
  return {
    ok: true,
    facts: {
      receipt_document_id: String(receipt.id),
      invoice_id: String(invoiceId),
      invoice_no: String(summary.invoice_no ?? "-"),
      company_name: String(company?.name ?? "-"),
      amount,
      paid_amount: Number(summary.paid_amount ?? 0),
      outstanding,
      derived_status: String(summary.derived_status ?? ""),
    },
  };
}


export async function previewPayment(input: PaymentInput): Promise<ActionResponse> {
  const resolved = await resolvePaymentFacts(input);
  if (!resolved.ok) {
    return { ok: false, mode: "preview", action: "payment", error: resolved.error };
  }
  const f = resolved.facts;
  // The token is a snapshot of the operation to confirm — never a financial authority
  // and never a carrier of identity: { receipt_document_id, invoice_id, amount }.
  const token = issueToken("payment", {
    receipt_document_id: f.receipt_document_id,
    invoice_id: f.invoice_id,
    amount: f.amount,
  });
  return {
    ok: true,
    mode: "preview",
    action: "payment",
    preview_token: token,
    preview: {
      receipt_document_id: f.receipt_document_id,
      invoice_id: f.invoice_id,
      document_number: f.invoice_no,
      party_name: f.company_name,
      amount: f.amount,
      paid_so_far: f.paid_amount,
      outstanding_amount: f.outstanding,
      status: f.derived_status,
      will_change: {
        note: "confirm จะจัดสรรเงินเข้า invoice ผ่าน canonical payment RPC ใน transaction เดียว",
        allocation_amount: f.amount,
      },
    },
    next_actions: [`.pay confirm ${f.receipt_document_id}`],
  };
}

/**
 * Confirms a payment through the canonical writer. `actor` is server context
 * (requireAuth → auth.email); a client-supplied actor is never read.
 */
export async function executePayment(payload: PaymentInput, actor: string): Promise<ActionResponse> {
  if (!actor?.trim()) {
    return { ok: false, mode: "execute", action: "payment", error: "AUDIT_ACTOR_REQUIRED: ต้องมี actor จาก server context" };
  }
  const resolved = await resolvePaymentFacts(payload);
  if (!resolved.ok) {
    return { ok: false, mode: "execute", action: "payment", error: resolved.error };
  }
  const f = resolved.facts;
  try {
    const confirmed = await confirmPayment({
      receipt_document_id: f.receipt_document_id,
      allocations: [
        {
          target: { kind: "invoice", id: f.invoice_id },
          allocation_kind: "principal",
          // the allocation amount is the receipt's canonical amount, re-read here — the
          // token's snapshot is informational only and is never used as authority
          amount: f.amount,
        },
      ],
      actor,
    });
    const invoice = confirmed.refreshed.invoices[0];
    return {
      ok: true,
      mode: "execute",
      action: "payment",
      result: {
        receipt_document_id: confirmed.receipt_document_id,
        invoice_id: f.invoice_id,
        allocation_ids: confirmed.allocation_ids,
        allocations_written: confirmed.allocations_written,
        amount_allocated: f.amount,
        invoice_paid_amount: invoice?.paid_amount ?? null,
        invoice_status: invoice?.invoice_status ?? null,
        receipt_allocation_state: confirmed.refreshed.receipt_allocation_state,
      },
      next_actions: [`.invoice find ${f.invoice_id}`, `.debt list`],
    };
  } catch (e) {
    // fail closed: canonical error only, no legacy fallback of any kind
    return { ok: false, mode: "execute", action: "payment", error: e instanceof Error ? e.message : "ยืนยันการชำระไม่สำเร็จ" };
  }
}

// ---- DOCUMENT CREATE ----
//
// Owner-reported bug 2026-07-11: this used to write to a `documents` table
// that never existed in the real schema ("Could not find the table
// 'public.documents'") — every confirm silently failed. The real tables
// are `invoices` (formal AR/debt tracking) and `standalone_documents`
// (quotation/receipt/delivery/BOQ/PO, enum QT/RCP/ORD/BOQ/PO/PV). Neither
// table has an items/line-items column (standalone_document_items was
// dropped in the 2026-07-10 data cleanup) — items only ever existed for
// building the rendered HTML/Flex card, not as a persisted line-item table.

// Only document types the ActionBar actually exposes are wired to a real
// enum value — anything else fails loudly instead of writing garbage.
const STANDALONE_ENUM: Partial<Record<DocType, string>> = {
  quotation: "QT",
  boq: "BOQ",
  delivery: "ORD",
  delivery_order: "ORD",
  purchase_order: "PO",
  receipt: "RCP",
  payment_voucher: "PV",
};

export async function previewDocumentCreate(payload: Record<string, unknown>): Promise<ActionResponse> {
  const required = ["document_type", "party_name", "net_amount"];
  const missing = required.filter((f) => payload[f] === undefined || payload[f] === null || payload[f] === "");
  if (missing.length > 0) {
    return { ok: false, mode: "preview", action: "document.create", error: `ขาดข้อมูล: ${missing.join(", ")}` };
  }
  if (!payload.customer_company_id) {
    return { ok: false, mode: "preview", action: "document.create", error: "ต้องจับคู่บริษัทลูกค้าก่อนถึงจะออกเอกสารได้" };
  }
  const documentType = normalizeDocumentType(String(payload.document_type));
  // Real incident (owner, 2026-07-31): a receipt (REC-20260731-302) was
  // created through this exact path with zero real payment — this generic
  // document builder has no concept of payment evidence at all, unlike the
  // real Rule 115 evidence pipeline (receipt_documents / bank_notifications
  // / payment-claim / OCR slip levels 1-4, human-confirmed at
  // app/api/admin/receipt-documents/[id]/confirm). A receipt asserts money
  // was actually received — that can only ever come from that verified
  // pipeline, never from a text command through the AI. Refuse here rather
  // than let a receipt be fabricated from thin air.
  if (documentType === "receipt") {
    return {
      ok: false,
      mode: "preview",
      action: "document.create",
      error: "ออกใบเสร็จผ่านช่องทางนี้ไม่ได้ครับ — ใบเสร็จต้องมีหลักฐานรับเงินจริงยืนยันก่อนเท่านั้น (สลิป/แจ้งเตือนธนาคาร) ไปที่หน้าเอกสารรอตรวจสอบเพื่อยืนยันการรับเงินแทนครับ",
    };
  }
  if (documentType !== "invoice" && !STANDALONE_ENUM[documentType]) {
    return { ok: false, mode: "preview", action: "document.create", error: `ยังไม่รองรับเอกสารประเภทนี้: ${documentType}` };
  }

  const token = issueToken("document.create", payload);

  // GenerateInvoicePreview (owner, 2026-07-17, Architecture Correction): the
  // full rendered card (items/totals/html/Flex) is built here, inside DNA
  // OS, not by the AI — previously cognitive/executor called generateDoc()
  // and documentFlex() itself after this returned only bare fields, meaning
  // the AI still had to import and drive two rendering engines directly to
  // show a preview. AI now gets one complete business response.
  const label = DOC_LABELS[documentType];
  const docNum = String(payload.document_number ?? `${label.prefix}-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${String(Date.now()).slice(-3)}`);
  const issueDate = String(payload.issue_date ?? new Date().toISOString().split("T")[0]);
  const items = normalizeItems(payload.items as DocItem[] | undefined, Number(payload.net_amount), label.th);

  // Invoice Consistency Fix (owner, 2026-07-17): business.calculate_tax is
  // the ONLY place VAT/totals are computed for this flow (see
  // engines/validation/dispatcher.ts's "invoice.preview"). When the caller
  // passes its result as `payload.tax`, generateDoc() renders those exact
  // figures verbatim (DocData.precomputedSummary) instead of recomputing —
  // one business calculation, many renderers. Callers with no upstream tax
  // capability yet (e.g. the manual document builder) omit `tax` and get
  // generateDoc's unchanged internal calculation.
  const tax = payload.tax as { subtotal: number; vatRate: number; vat: number; total: number } | undefined;

  const rendered = generateDoc({
    type: documentType,
    docNumber: docNum,
    date: issueDate,
    status: "draft",
    customer: { name: String(payload.party_name) },
    items,
    notes: payload.note as string | undefined,
    precomputedSummary: tax,
  });

  const branding = await loadCompanySettings();
  const flexPreview = documentFlex({
    documentType,
    documentNumber: docNum,
    partyName: String(payload.party_name),
    items,
    summary: rendered.summary,
    branding: {
      ourCompanyName: branding.companyName || undefined,
      ourCompanyTaxId: branding.companyTaxId || undefined,
      terms: branding.documentTerms || undefined,
      footerNote: branding.documentFooterNote || undefined,
    },
  });

  return {
    ok: true,
    mode: "preview",
    action: "document.create",
    preview_token: token,
    preview: {
      document_type: payload.document_type,
      document_number: docNum,
      party_name: payload.party_name,
      net_amount: rendered.summary.total,
      issue_date: issueDate,
      note: payload.note ?? null,
      items,
      html: rendered.html,
      summary: rendered.summary,
      flex_preview: flexPreview,
      will_create: {
        table: documentType === "invoice" ? "invoices" : "standalone_documents",
        source: "deadboard",
      },
    },
    next_actions: [
      `ยืนยัน → execute`,
    ],
  };
}

export async function executeDocumentCreate(payload: {
  document_type: string;
  document_number?: string;
  party_name: string;
  customer_company_id?: string;
  net_amount: number;
  issue_date?: string;
  note?: string;
  items?: DocItem[];
  tax?: { subtotal: number; vatRate: number; vat: number; total: number };
}, actor: string): Promise<ActionResponse> {
  if (!actor?.trim()) {
    return { ok: false, mode: "execute", action: "document.create", error: "AUDIT_ACTOR_REQUIRED: ต้องมี actor จาก server context" };
  }
  if (!payload.customer_company_id) {
    return { ok: false, mode: "execute", action: "document.create", error: "ต้องจับคู่บริษัทลูกค้าก่อนถึงจะออกเอกสารได้" };
  }

  const documentType = normalizeDocumentType(payload.document_type);
  // Same guard as previewDocumentCreate — belt-and-suspenders in case a
  // preview_token for a receipt was issued before this fix and someone
  // still tries to confirm/execute it.
  if (documentType === "receipt") {
    return {
      ok: false,
      mode: "execute",
      action: "document.create",
      error: "ออกใบเสร็จผ่านช่องทางนี้ไม่ได้ครับ — ใบเสร็จต้องมีหลักฐานรับเงินจริงยืนยันก่อนเท่านั้น",
    };
  }
  const label = DOC_LABELS[documentType];
  const docNum = payload.document_number ?? `${label.prefix}-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${String(Date.now()).slice(-3)}`;
  const issueDate = payload.issue_date ?? new Date().toISOString().split("T")[0];
  const items = normalizeItems(payload.items, payload.net_amount, label.th);
  const documentData: DocData = {
    type: documentType,
    docNumber: docNum,
    date: issueDate,
    status: "saved",
    customer: { name: payload.party_name },
    items,
    notes: payload.note,
    // ConfirmInvoice must persist the EXACT totals the human approved in
    // Preview (owner, 2026-07-17) — payload.tax is the same
    // business.calculate_tax result that was already threaded into
    // previewDocumentCreate() and carried unchanged inside the preview_token
    // (see dispatchAction's "execute must run on exactly what was
    // previewed" comment). Re-rendering here with the same precomputedSummary
    // guarantees this render is byte-identical to what was shown.
    precomputedSummary: payload.tax,
  };
  const rendered = generateDoc(documentData);

  let savedId: string;
  let savedStatus: string;

  if (documentType === "invoice") {
    // ConfirmInvoice (owner, 2026-07-17, Invoice Workflow Redesign): header
    // + line items committed in ONE Postgres transaction via the
    // confirm_invoice() function (supabase/migrations/
    // 20260717000003_invoice_items.sql) — Supabase's JS/REST client has no
    // multi-statement transaction primitive, so an RPC call is the only way
    // to guarantee this per the owner's explicit "commit one transaction"
    // requirement. Does NOT touch LINE — that is SendInvoiceToLINE's job
    // alone (owner: "Do not combine ConfirmInvoice and SendInvoiceToLINE").
    // vat_rate/vat_amount/total_amount come straight from rendered.summary,
    // which (via precomputedSummary above) IS payload.tax verbatim — not
    // recalculated here.
    const { data: newInvoiceId, error } = await supabase().rpc("confirm_invoice", {
      p_invoice_no: docNum,
      p_customer_company_id: payload.customer_company_id,
      p_invoice_date: issueDate,
      p_subtotal: rendered.summary.subtotal,
      p_vat_rate: payload.tax?.vatRate ?? 0,
      p_vat_amount: rendered.summary.vat,
      p_total_amount: rendered.summary.total,
      p_notes: payload.note ?? null,
      p_items: items,
    });
    if (error) return { ok: false, mode: "execute", action: "document.create", error: error.message };
    savedId = newInvoiceId as string;
    savedStatus = "DRAFT"; // confirm_invoice() always inserts as DRAFT — "created, not yet sent to customer"
  } else {
    const enumValue = STANDALONE_ENUM[documentType];
    if (!enumValue) {
      return { ok: false, mode: "execute", action: "document.create", error: `ยังไม่รองรับเอกสารประเภทนี้: ${documentType}` };
    }
    // PHASE C cutover (2026-09-23): this used to be a direct
    // `.from("standalone_documents").insert({...})` that wrote a header with
    // caller-supplied totals and NO line items. It now goes through the canonical
    // document authority, which owns validation, the money ladder
    // (computeCanonicalTotals), the items, the version and the audit.
    // Compatibility mapping (recorded, not invented):
    //   status "saved"  -> canonical standalone creation state "active"
    //   vat_rate 0.07   -> canonical vatEnabled (7% when the approved preview had VAT)
    //   items           -> now persisted (canonical requirement; the old path dropped them)
    try {
      const written = await createDocument({
        kind: "standalone_document",
        document_no: docNum,
        document_type: enumValue,
        customer_company_id: payload.customer_company_id,
        issue_date: issueDate,
        notes: payload.note ?? null,
        rows: items.map((it) => ({ qty: Number(it.qty) || 0, unitPrice: Number(it.unitPrice) || 0 })),
        vatEnabled: (payload.tax?.vatRate ?? 0) > 0,
        items: items.map((it, i) => ({
          description: it.description,
          qty: Number(it.qty) || 0,
          unit: it.unit ?? null,
          unit_price: Number(it.unitPrice) || 0,
          sort_order: i,
        })),
        actor,
        status: "active",
      });
      savedId = written.document_id;
      savedStatus = "saved";
    } catch (err) {
      return {
        ok: false, mode: "execute", action: "document.create",
        error: `สร้างเอกสารผ่าน canonical writer ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    ok: true,
    mode: "execute",
    action: "document.create",
    result: {
      id: savedId,
      document_id: savedId,
      document_type: documentType,
      document_number: docNum,
      party_name: payload.party_name,
      status: savedStatus,
      html: rendered.html,
      summary: rendered.summary,
      items,
      presenter: {
        title: `${rendered.label.th} ${docNum}`,
        summary: `${payload.party_name} • ${rendered.summary.total.toLocaleString("th-TH")} บาท`,
      },
    },
    next_actions: [
      `.invoice find ${docNum}`,
      `.doc list`,
    ],
  };
}

// ---- SEND INVOICE TO LINE ----
//
// SendInvoiceToLINE(invoiceId) — owner, 2026-07-17, Invoice Workflow
// Redesign. Deliberately a SEPARATE capability from ConfirmInvoice, called
// only after it succeeds, never fused into one operation (explicit owner
// instruction). Loads the SAVED invoice (never trusts caller-supplied
// totals/items — re-reads from the committed rows), builds the Flex
// message, pushes to LINE, and only then flips invoice_status → SENT.
// If the LINE push fails, invoice_status is left untouched (still DRAFT —
// this codebase's "created, not yet sent" state) so this same function can
// be called again later with the same invoiceId: Retry Send, never
// recreates the invoice or its items.
export async function sendInvoiceToLine(invoiceId: string, actor: string): Promise<ActionResponse> {
  // PHASE C (owner decision 2026-09-23) — DOCUMENT STATE ≠ DELIVERY STATE.
  //   document lifecycle (DRAFT → SENT) is owned by the canonical document
  //   authority: engines/canonical/document-write.ts#issueDocument (validation
  //   + version + audit). Delivery to a provider NEVER decides document state.
  //   Delivery is recorded as EVIDENCE in the existing outbound record
  //   (line_events, direction "out" — the same pattern send-debt / reply /
  //   send-document already use) and THAT evidence is what retry/idempotency
  //   reads — not invoice_status. A failed push therefore cannot roll back
  //   issuance, and a SENT invoice can still be (re)sent when no delivery
  //   evidence exists yet.
  if (!actor?.trim()) {
    return { ok: false, mode: "execute", action: "invoice.send", error: "AUDIT_ACTOR_REQUIRED: ต้องมี actor จาก server context" };
  }
  const { data: invoice, error: invoiceError } = await supabase()
    .from("invoices")
    .select("id, invoice_no, invoice_status, customer_company_id, subtotal, vat_amount, total_amount, companies(name)")
    .eq("id", invoiceId)
    .single();
  if (invoiceError || !invoice) {
    return { ok: false, mode: "execute", action: "invoice.send", error: invoiceError?.message ?? "ไม่พบใบแจ้งหนี้นี้ในระบบ" };
  }
  if (invoice.invoice_status === "VOID") {
    return { ok: false, mode: "execute", action: "invoice.send", error: `ใบแจ้งหนี้ ${invoice.invoice_no} ถูกยกเลิกแล้ว` };
  }

  // Retry / idempotency from DELIVERY EVIDENCE, not from document status.
  const { data: delivered } = await supabase()
    .from("line_events")
    .select("id, created_at")
    .eq("direction", "out")
    .eq("extracted->>document_id", invoiceId)
    .limit(1);
  if (delivered?.length) {
    return { ok: false, mode: "execute", action: "invoice.send", error: `ใบแจ้งหนี้ ${invoice.invoice_no} ถูกส่งไปแล้ว` };
  }

  const { data: itemRows, error: itemsError } = await supabase()
    .from("invoice_items")
    .select("description, qty, unit, unit_price")
    .eq("invoice_id", invoiceId)
    .order("sort_order", { ascending: true });
  if (itemsError) {
    return { ok: false, mode: "execute", action: "invoice.send", error: itemsError.message };
  }
  const items: DocItem[] = (itemRows ?? []).map((it) => ({
    description: it.description, qty: Number(it.qty), unit: it.unit, unitPrice: Number(it.unit_price),
  }));

  // Document lifecycle — owned by the canonical document authority, performed
  // BEFORE transport so a delivery failure can never roll issuance back.
  if (invoice.invoice_status === "DRAFT") {
    try {
      await issueDocument({ document_kind: "invoice", document_id: invoiceId, actor });
    } catch (err) {
      return {
        ok: false, mode: "execute", action: "invoice.send",
        error: `ออกเอกสาร (issue) ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const { data: link } = await supabase()
    .from("company_line_links")
    .select("line_user_id")
    .eq("company_id", invoice.customer_company_id)
    .maybeSingle();
  if (!link?.line_user_id) {
    return { ok: false, mode: "execute", action: "invoice.send", error: "ลูกค้ารายนี้ยังไม่ได้เชื่อมบัญชี LINE — ส่งอัตโนมัติไม่ได้" };
  }

  const branding = await loadCompanySettings();
  const partyName = (invoice as { companies?: { name?: string } }).companies?.name ?? "";
  const flex = documentFlex({
    documentType: "invoice",
    documentNumber: invoice.invoice_no,
    partyName,
    items,
    summary: { subtotal: Number(invoice.subtotal), vat: Number(invoice.vat_amount), total: Number(invoice.total_amount) },
    branding: {
      ourCompanyName: branding.companyName || undefined,
      ourCompanyTaxId: branding.companyTaxId || undefined,
      terms: branding.documentTerms || undefined,
      footerNote: branding.documentFooterNote || undefined,
    },
  });

  const lineRes = await sendLineMessage(supabase(), link.line_user_id, [
    { type: "flex", altText: `ใบแจ้งหนี้ ${invoice.invoice_no}`, contents: flex },
  ]);

  if (!lineRes.success) {
    // Delivery failed → the document stays exactly as issued. Retry is possible
    // because no delivery evidence was written.
    return { ok: false, mode: "execute", action: "invoice.send", error: `ส่ง LINE ไม่สำเร็จ: ${(lineRes.error ?? "").slice(0, 200)}` };
  }

  // Delivery EVIDENCE (line_events, direction "out") — the record the retry
  // guard above and the admin control room both read. Provider text is never
  // stored: only the exact card that was sent plus the canonical document ref.
  const { error: evidenceError } = await supabase().from("line_events").insert({
    line_user_id: link.line_user_id,
    raw_type: "flex",
    raw_text: `📄 ส่งใบแจ้งหนี้ ${invoice.invoice_no} ให้ ${partyName}`,
    direction: "out",
    line_message_id: lineRes.messageId ?? null,
    extracted: { flex, document_kind: "invoice", document_id: invoiceId, document_no: invoice.invoice_no, provider: "line" },
  });

  return {
    ok: true,
    mode: "execute",
    action: "invoice.send",
    // flex_preview included so the caller (e.g. Retry Send button) can render the
    // same chat-timeline bubble that was actually pushed, not a rebuild.
    result: {
      invoice_id: invoiceId, invoice_no: invoice.invoice_no, status: "SENT", flex_preview: flex,
      delivery_evidence_recorded: !evidenceError,
      ...(evidenceError ? { delivery_evidence_error: evidenceError.message } : {}),
    },
  };
}

function normalizeDocumentType(documentType: string): DocType {
  if (documentType === "delivery") return "delivery_order";
  if (documentType in DOC_LABELS) return documentType as DocType;
  return "quotation";
}

function normalizeItems(items: DocItem[] | undefined, netAmount: number, fallbackLabel: string): DocItem[] {
  if (items?.length) return items;
  return [{
    description: fallbackLabel,
    qty: 1,
    unit: "รายการ",
    unitPrice: Number.isFinite(netAmount) ? netAmount : 0,
  }];
}

// ---- DEBT TRACKING CREATE ----

export async function previewDebtCreate(payload: Record<string, unknown>): Promise<ActionResponse> {
  if (!payload.customer_name || !payload.principal_amount) {
    return { ok: false, mode: "preview", action: "debt.create", error: "ต้องระบุ customer_name และ principal_amount" };
  }

  const token = issueToken("debt.create", payload);

  return {
    ok: true,
    mode: "preview",
    action: "debt.create",
    preview_token: token,
    preview: {
      customer_name: payload.customer_name,
      principal_amount: payload.principal_amount,
      fee_rate: payload.fee_rate ?? 5.0,
      interest_start_at: payload.interest_start_at ?? new Date().toISOString(),
      will_create: {
        table: "debt_trackings",
        source: "deadboard",
      },
    },
    next_actions: [
      `ยืนยัน → execute`,
    ],
  };
}

export async function executeDebtCreate(payload: {
  customer_name: string;
  principal_amount: number;
  fee_rate?: number;
  interest_start_at?: string;
}): Promise<ActionResponse> {
  const { data, error } = await supabase()
    .from("debt_trackings")
    .insert({
      customer_name: payload.customer_name,
      principal_amount: payload.principal_amount,
      fee_rate: payload.fee_rate ?? 5.0,
      interest_start_at: payload.interest_start_at ?? new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return { ok: false, mode: "execute", action: "debt.create", error: error.message };
  }

  return {
    ok: true,
    mode: "execute",
    action: "debt.create",
    result: { id: data.id, customer_name: data.customer_name, principal_amount: data.principal_amount },
    next_actions: [
      `.debt find ${data.customer_name}`,
      `.debt list`,
    ],
  };
}

// ---- DISPATCH ----

export async function dispatchAction(req: ActionRequest): Promise<ActionResponse> {
  const { action, mode } = req;
  let payload = req.payload;

  if (mode === "execute") {
    if (!req.preview_token) {
      return { ok: false, mode, action, error: "ต้อง preview ก่อน — ไม่มี preview_token" };
    }
    const guard = consumeToken(req.preview_token, action);
    if (!guard.valid) {
      return { ok: false, mode, action, error: guard.error! };
    }
    // Rule 72's whole point: execute must run on exactly what was previewed
    // and approved, not whatever the caller sends at confirm time — bug
    // found 2026-07-11: consumeToken() used to discard the stored payload,
    // so every confirm ran executeDocumentCreate() with an empty payload.
    payload = guard.payload ?? payload;
  }

  switch (action) {
    case "payment":
      return mode === "preview"
        ? previewPayment(payload as unknown as Parameters<typeof previewPayment>[0])
        : executePayment(payload as unknown as Parameters<typeof executePayment>[0], req.actor ?? "");

    case "document.create":
      return mode === "preview"
        ? previewDocumentCreate(payload)
        : executeDocumentCreate(payload as Parameters<typeof executeDocumentCreate>[0], req.actor ?? "");

    case "debt.create":
      return mode === "preview"
        ? previewDebtCreate(payload)
        : executeDebtCreate(payload as Parameters<typeof executeDebtCreate>[0]);

    default:
      return { ok: false, mode, action, error: `ไม่รู้จัก action: ${action}` };
  }
}
