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
import { documentFlex } from "@/engines/documents/flex-template";
import { loadCompanySettings } from "@/core/config/company-settings";
import { randomUUID } from "crypto";
import { sendLineMessage } from "@/registry/communication";

// ---- Types ----

export interface ActionRequest {
  action: string;
  mode: "preview" | "execute";
  payload: Record<string, unknown>;
  preview_token?: string;
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

// ---- PAYMENT ----

export async function previewPayment(invoiceDebtId: string): Promise<ActionResponse> {
  const { data: debt, error: debtErr } = await supabase()
    .from("invoice_debts")
    .select("id, document_id, principal_amount, outstanding_amount, invoice_status, paid_amount, current_interest_amount")
    .eq("id", invoiceDebtId)
    .single();

  if (debtErr || !debt) {
    return { ok: false, mode: "preview", action: "payment", error: debtErr?.message ?? "ไม่พบหนี้" };
  }

  const { data: doc } = await supabase()
    .from("documents")
    .select("document_number, party_name, net_amount")
    .eq("id", debt.document_id)
    .single();

  const token = issueToken("payment", { invoice_debt_id: invoiceDebtId });

  return {
    ok: true,
    mode: "preview",
    action: "payment",
    preview_token: token,
    preview: {
      invoice_debt_id: debt.id,
      document_number: doc?.document_number ?? "-",
      party_name: doc?.party_name ?? "-",
      principal_amount: debt.principal_amount,
      outstanding_amount: debt.outstanding_amount,
      current_interest: debt.current_interest_amount,
      paid_so_far: debt.paid_amount,
      status: debt.invoice_status,
      will_change: {
        invoice_status: "OPEN → PAID",
        outstanding_amount: `${debt.outstanding_amount} → 0`,
        triggers: ["back-to-back webhook จะยิงอัตโนมัติ", "LINE Notify แจ้งเจ้าของ"],
      },
    },
    next_actions: [
      `.pay execute ${debt.id} ${debt.outstanding_amount}`,
    ],
  };
}

export async function executePayment(payload: {
  invoice_debt_id: string;
  payment_amount: number;
  note?: string;
}): Promise<ActionResponse> {
  if (!payload.invoice_debt_id || !payload.payment_amount) {
    return { ok: false, mode: "execute", action: "payment", error: "ต้องระบุ invoice_debt_id และ payment_amount" };
  }

  const { data: debt, error: debtErr } = await supabase()
    .from("invoice_debts")
    .select("id, document_id, outstanding_amount, invoice_status")
    .eq("id", payload.invoice_debt_id)
    .single();

  if (debtErr || !debt) {
    return { ok: false, mode: "execute", action: "payment", error: debtErr?.message ?? "ไม่พบหนี้" };
  }

  if (debt.invoice_status === "PAID") {
    return { ok: false, mode: "execute", action: "payment", error: "หนี้นี้ชำระแล้ว" };
  }

  const { data: payment, error: payErr } = await supabase()
    .from("invoice_payments")
    .insert({
      invoice_debt_id: payload.invoice_debt_id,
      payment_amount: payload.payment_amount,
      paid_at: new Date().toISOString(),
      principal_before_payment: debt.outstanding_amount,
      outstanding_before_payment: debt.outstanding_amount,
      outstanding_after_payment: Math.max(0, debt.outstanding_amount - payload.payment_amount),
      note: payload.note ?? null,
    })
    .select()
    .single();

  if (payErr) {
    return { ok: false, mode: "execute", action: "payment", error: payErr.message };
  }

  const newOutstanding = Math.max(0, debt.outstanding_amount - payload.payment_amount);
  const newStatus = newOutstanding <= 0 ? "PAID" : "OPEN";

  await supabase()
    .from("invoice_debts")
    .update({
      paid_amount: payload.payment_amount,
      outstanding_amount: newOutstanding,
      invoice_status: newStatus,
      paid_at: newStatus === "PAID" ? new Date().toISOString() : null,
    })
    .eq("id", payload.invoice_debt_id);

  return {
    ok: true,
    mode: "execute",
    action: "payment",
    result: {
      payment_id: payment.id,
      amount_paid: payload.payment_amount,
      outstanding_after: newOutstanding,
      new_status: newStatus,
    },
    next_actions: [
      `.invoice find ${debt.document_id}`,
      `.debt list`,
    ],
  };
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
}): Promise<ActionResponse> {
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
    const { data, error } = await supabase()
      .from("standalone_documents")
      .insert({
        document_no: docNum,
        document_type: enumValue,
        document_date: issueDate,
        customer_company_id: payload.customer_company_id,
        vat_rate: 0.07,
        subtotal: rendered.summary.subtotal,
        vat_amount: rendered.summary.vat,
        total_amount: rendered.summary.total,
        notes: payload.note,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) return { ok: false, mode: "execute", action: "document.create", error: error.message };
    savedId = data.id;
    savedStatus = "saved";
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
export async function sendInvoiceToLine(invoiceId: string): Promise<ActionResponse> {
  const { data: invoice, error: invoiceError } = await supabase()
    .from("invoices")
    .select("id, invoice_no, invoice_status, customer_company_id, subtotal, vat_amount, total_amount, companies(name)")
    .eq("id", invoiceId)
    .single();
  if (invoiceError || !invoice) {
    return { ok: false, mode: "execute", action: "invoice.send", error: invoiceError?.message ?? "ไม่พบใบแจ้งหนี้นี้ในระบบ" };
  }
  if (invoice.invoice_status === "SENT") {
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

  const lineRes = await sendLineMessage(link.line_user_id, [
    { type: "flex", altText: `ใบแจ้งหนี้ ${invoice.invoice_no}`, contents: flex },
  ]);

  if (!lineRes.success) {
    // Owner instruction: on LINE push failure, invoice stays saved as-is
    // (status untouched — still DRAFT) so Retry Send can call this same
    // function again without recreating anything.
    return { ok: false, mode: "execute", action: "invoice.send", error: `ส่ง LINE ไม่สำเร็จ: ${(lineRes.error ?? "").slice(0, 200)}` };
  }

  const { error: statusError } = await supabase()
    .from("invoices")
    .update({ invoice_status: "SENT", updated_at: new Date().toISOString() })
    .eq("id", invoiceId);
  if (statusError) {
    // LINE push already succeeded — do not report this as a send failure
    // (that would invite an accidental duplicate push on retry). Surface it
    // honestly as a separate, lower-severity problem instead.
    return {
      ok: true, mode: "execute", action: "invoice.send",
      result: { invoice_id: invoiceId, invoice_no: invoice.invoice_no, line_pushed: true, flex_preview: flex },
      error: `ส่ง LINE สำเร็จ แต่อัปเดตสถานะไม่สำเร็จ: ${statusError.message}`,
    };
  }

  return {
    ok: true,
    mode: "execute",
    action: "invoice.send",
    // flex_preview included so the caller (e.g. Retry Send button) can
    // render the same chat-timeline bubble the auto-send path already
    // does — same object that was actually pushed to LINE, not rebuilt
    // again client-side.
    result: { invoice_id: invoiceId, invoice_no: invoice.invoice_no, status: "SENT", flex_preview: flex },
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
        ? previewPayment(payload.invoice_debt_id as string)
        : executePayment(payload as Parameters<typeof executePayment>[0]);

    case "document.create":
      return mode === "preview"
        ? previewDocumentCreate(payload)
        : executeDocumentCreate(payload as Parameters<typeof executeDocumentCreate>[0]);

    case "debt.create":
      return mode === "preview"
        ? previewDebtCreate(payload)
        : executeDebtCreate(payload as Parameters<typeof executeDebtCreate>[0]);

    default:
      return { ok: false, mode, action, error: `ไม่รู้จัก action: ${action}` };
  }
}
