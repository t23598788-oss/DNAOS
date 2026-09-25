/**
 * buildChatResult — RESPONSE CONTRACT (owner spec 2026-09-25 BUSINESS RESULT
 * PRESENTATION): query ผ่าน canonical API/reader เดิม (proxy ไป route ที่มีอยู่
 * ด้วย cookie ของผู้เรียกคนเดิม) — ไม่มี logic การเงินใหม่ ไม่มีตัวเลขจาก
 * LLM ไม่มี business shape ซ้ำ:
 *   finance_summary → /api/admin/finance-summary + /api/admin/documents (แถว canonical)
 *   document        → /api/admin/documents?type=… + /{id} → engine จริง (draftToDocData+generateDoc)
 *   timeline        → /api/admin/partners?search= + /partners/{id}/timeline (engine เดิม)
 *   confirmation/doc_html → board fields เดิม ไม่เปลี่ยน
 */
import type { ChatResult, ResultField, ResultTable } from "./chatResultTypes";
import {
  createEmptyDocumentDraft,
  draftToDocData,
  formatMoney,
  type DocumentDraftInput,
  type DocumentType,
} from "@/engines/documents/document-editor";
import { DOC_LABELS, generateDoc } from "@/engines/documents/engine";
import { loadCompanySettings } from "@/core/config/company-settings";

// ── intent matchers (pure function ตรวจ/ทดสอบง่าย — เรียกจาก buildChatResult เท่านั้น) ──

function isFinanceIntent(message: string): boolean {
  return /การเงิน|รายรับ|รายจ่าย|ลูกหนี้|หนี้ค้าง|ยอดค้าง|VAT|WHT|ภาษี|ชำระเงิน|สรุป.*เงิน/i.test(message);
}

const DOC_KEYWORDS: [RegExp, DocumentType][] = [
  [/ใบแจ้งหนี้/, "invoice"],
  [/ใบรับเงิน|ใบเสร็จ/, "receipt"],
  [/ใบเสนอราคา/, "quotation"],
  [/ใบสั่งซื้อ/, "purchase_order"],
  [/ใบส่งของ|ใบส่งสินค้า/, "delivery_order"],
  [/ใบสำคัญจ่าย/, "payment_voucher"],
  [/ใบติดตามหนี้|ใบทวง/, "debt_notice"],
];

function documentIntentType(message: string): DocumentType | null {
  if (!/(เปิด|ดู|โชว์|แสดง|ออกรายงาน)/.test(message)) return null;
  for (const [re, type] of DOC_KEYWORDS) if (re.test(message)) return type;
  return null;
}

function timelineIntentName(message: string): string | null {
  if (!/(ประวัติ|ไทม์ไลน์)/.test(message)) return null;
  const m = message.match(
    /(?:แสดง|เปิด|ดู)?\s*(?:ประวัติ|ไทม์ไลน์)\s*(?:ของ|:)?\s*(?:บริษัท|ลูกค้า|คู่ค้า|พาร์ทเนอร์)?\s*(.+)/,
  );
  const name = (m?.[1] ?? "").replace(/\s*(จริง|ด้วย|นะ|ครับ|ค่ะ)\s*$/, "").trim();
  return name || null;
}

// ── proxy ไป canonical API เดิม (cookie ของผู้เรียกคนเดิม) ─────────────────

async function proxyJson<T>(req: Request, path: string): Promise<T | null> {
  try {
    const res = await fetch(new URL(path, req.url), {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function localMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const cell = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : formatMoney(Number(n));

// ── finance_summary ─────────────────────────────────────────────────────────

type FinanceSummaryResponse = {
  ok?: boolean;
  months?: { month: string; revenue_documented: number; payments_allocated: number; fuel_bills: number }[];
  totals?: Record<string, number>;
  revenue_basis?: string;
  payment_basis?: string;
  honesty_note?: string;
};

const FINANCE_COLUMNS: ResultTable["columns"] = [
  { key: "d1", label: "วันที่" },
  { key: "d2", label: "บริษัท/รายการ" },
  { key: "d3", label: "เลขเอกสาร" },
  { key: "d4", label: "ก่อน VAT" },
  { key: "d5", label: "VAT" },
  { key: "d6", label: "WHT" },
  { key: "d7", label: "ยอดสุทธิ" },
  { key: "d8", label: "ชำระแล้ว" },
  { key: "d9", label: "คงเหลือ" },
];

type DocumentListRow = {
  id: string;
  document_number: string;
  party_name: string;
  issue_date: string | null;
  canonical: {
    subtotal: number | null;
    vat_amount: number | null;
    wht_amount: number | null;
    net_payable: number | null;
    paid_amount: number | null;
    outstanding: number | null;
  } | null;
};

async function financeTable(req: Request, month: string): Promise<ResultTable> {
  const rows: { date: string; cells: string[] }[] = [];
  for (const type of ["invoice", "receipt", "purchase_order", "delivery_order", "payment_voucher", "debt_notice"]) {
    const list = await proxyJson<{ documents?: DocumentListRow[] }>(
      req,
      `/api/admin/documents?type=${type}&perPage=100`,
    );
    for (const d of list?.documents ?? []) {
      if (!d.issue_date || !d.issue_date.startsWith(month)) continue;
      if (!d.canonical) continue;
      rows.push({
        date: d.issue_date,
        cells: [
          d.issue_date,
          d.party_name || "—",
          d.document_number || "—",
          cell(d.canonical.subtotal),
          cell(d.canonical.vat_amount),
          cell(d.canonical.wht_amount),
          cell(d.canonical.net_payable),
          cell(d.canonical.paid_amount),
          cell(d.canonical.outstanding),
        ],
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { columns: FINANCE_COLUMNS, rows: rows.slice(0, 50).map((r) => r.cells) };
}

async function financeResult(req: Request): Promise<Extract<ChatResult, { type: "finance_summary" }> | null> {
  const fin = await proxyJson<FinanceSummaryResponse>(req, "/api/admin/finance-summary");
  if (!fin?.ok) return null;
  const month = localMonth();
  const m = fin.months?.find((x) => x.month === month);
  const totals = fin.totals ?? {};
  const summary: ResultField[] = [];
  const push = (id: string, label: string, v: unknown) => {
    if (v === null || v === undefined) return;
    summary.push({ id, label, value: cell(Number(v)) });
  };
  if (m) {
    push("m1", `รายได้เดือนนี้ (${month})`, m.revenue_documented);
    push("m2", "รับชำระเดือนนี้ (จัดสรรแล้ว)", m.payments_allocated);
    push("m3", "ค่าน้ำมันเดือนนี้", m.fuel_bills);
  }
  push("t1", "VAT ขาย (สะสมทั้งระบบ)", totals.revenue_vat_output);
  push("t2", "WHT ขาย (สะสมทั้งระบบ)", totals.revenue_wht_output);
  push("t3", "VAT ซื้อ (สะสม)", totals.vat_input);
  push("t4", "หนี้ค้างชำระรวม (ledger)", totals.outstanding_debt);
  const notes = [fin.revenue_basis, fin.payment_basis, fin.honesty_note].filter(Boolean) as string[];
  const table = await financeTable(req, month);
  return { type: "finance_summary", title: `สรุปการเงินเดือน ${month}`, summary, notes, table };
}

// ── document ────────────────────────────────────────────────────────────────

type DocumentPayload = {
  document_number?: string;
  issue_date?: string | null;
  due_date?: string | null;
  reference_number?: string | null;
  note?: string | null;
  vat_enabled?: boolean;
  partner_id?: string | null;
  party_name?: string;
  partners?: { name?: string; phone?: string; address?: string } | null;
  data?: { items?: { description?: string; qty?: number; unit_label?: string; unit_price?: number }[] };
};

async function documentResult(
  req: Request,
  docType: DocumentType,
): Promise<Extract<ChatResult, { type: "document" }> | null> {
  const list = await proxyJson<{ documents?: { id: string; document_number?: string }[] }>(
    req,
    `/api/admin/documents?type=${docType}&perPage=1`,
  );
  const doc = list?.documents?.[0];
  if (!doc) return null;
  const full = await proxyJson<{ document?: DocumentPayload }>(req, `/api/admin/documents/${doc.id}`);
  const d = full?.document;
  if (!d) return null;
  const settings = await loadCompanySettings().catch(() => null);
  if (!settings) return null;

  // draft ชุดเดียวกับ DocumentBuilder/DocumentPreview (default จาก
  // createEmptyDocumentDraft — ไม่มีค่าเดา) → render ด้วย engine จริง
  const draft: DocumentDraftInput = {
    ...createEmptyDocumentDraft(docType),
    type: docType,
    documentNumber: d.document_number ?? doc.document_number ?? "",
    issueDate: d.issue_date ?? "",
    dueDate: d.due_date ?? "",
    reference: d.reference_number ?? "",
    note: d.note ?? "",
    vatEnabled: typeof d.vat_enabled === "boolean" ? d.vat_enabled : true,
    partnerId: d.partner_id ?? "",
    customer: {
      name: d.party_name ?? "",
      tax: "",
      addr: d.partners?.address ?? "",
      contact: "",
      tel: d.partners?.phone ?? "",
    },
    rows: (d.data?.items ?? []).map((it) => ({
      description: String(it.description ?? ""),
      qty: Number(it.qty ?? 1),
      unit: String(it.unit_label ?? "หน่วย"),
      unitPrice: Number(it.unit_price ?? 0),
    })),
  };
  const html = generateDoc(draftToDocData(draft, draft.documentNumber || "เอกสาร", settings)).html;
  const label = DOC_LABELS[docType]?.th ?? "เอกสาร";
  return { type: "document", title: `${label} ${doc.document_number ?? ""}`.trim(), html };
}

// ── timeline ────────────────────────────────────────────────────────────────

async function timelineResult(req: Request, name: string): Promise<Extract<ChatResult, { type: "timeline" }> | null> {
  const search = await proxyJson<{ partners?: { id: string; name: string }[] }>(
    req,
    `/api/admin/partners?search=${encodeURIComponent(name)}`,
  );
  const partner = search?.partners?.[0];
  if (!partner) return null;
  const tl = await proxyJson<{
    summary: Extract<ChatResult, { type: "timeline" }>["summary"];
    timeline: Extract<ChatResult, { type: "timeline" }>["items"];
  }>(req, `/api/admin/partners/${partner.id}/timeline`);
  if (!tl) return null;
  return { type: "timeline", title: `ประวัติ ${partner.name}`, summary: tl.summary ?? null, items: tl.timeline ?? [] };
}

// ── entry ───────────────────────────────────────────────────────────────────

type PipelineLike = {
  text?: string;
  confirm_token?: string;
  confirm_action?: string;
  flex_preview?: unknown;
  doc_html?: string;
};

export async function buildChatResult(
  req: Request,
  message: string,
  pipeline: PipelineLike,
): Promise<ChatResult | null> {
  // Rule 72 preview — confirmation (html/flex = preview ตัวจริงจาก board เดิม)
  if (pipeline.confirm_token) {
    return {
      type: "confirmation",
      text: pipeline.text ?? "",
      action: String(pipeline.confirm_action ?? ""),
      token: String(pipeline.confirm_token),
      html: pipeline.doc_html,
    };
  }
  if (pipeline.doc_html) {
    return { type: "document", title: "เอกสาร", html: pipeline.doc_html };
  }
  try {
    if (isFinanceIntent(message)) return await financeResult(req);
    const name = timelineIntentName(message);
    if (name) return await timelineResult(req, name);
    const docType = documentIntentType(message);
    if (docType) return await documentResult(req, docType);
  } catch {
    // canonical query ล้มเหลว → null = route ใช้ข้อความ pipeline เดิม (ไม่เดา ไม่แต่ง)
    return null;
  }
  return null;
}
