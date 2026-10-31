/**
 * buildChatResult — RESPONSE CONTRACT (owner spec 2026-09-25 BUSINESS RESULT
 * PRESENTATION) + owner step "ui-baseline-workspace-2026-10-08" ข้อ 3–4:
 *   คำสั่งอ่าน (document.list, partner.find, partner.timeline) วิ่งผ่าน
 *   engines/validation/dispatcher#dispatch — registry gate + input validation
 *   + Rule-72 confirmation gate ของคำสั่งนั้น ๆ (อ่านล้วน ไม่มีเส้นทางเขียน)
 *   เอกสารอ่านจาก getDocumentDetail() → document_versions → document_artifacts
 *   (version snapshot ต้นฉบับ — ห้าม generateDoc() ทดแทนไฟล์ต้นฉบับ)
 *   finance_summary ยังคงอ่านผ่าน /api/admin/finance-summary (route อ่าน
 *   ที่ requireAuth เดิม — ไม่มีคำสั่ง finance ใน registry จึงยังไม่ผ่าน
 *   dispatcher · ไม่ใช่เส้นทางเขียนข้อมูล)
 *   confirmation/doc_html → board fields เดิม ไม่เปลี่ยน
 */
import type { ChatResult, ResultField, ResultSectionLike, ResultTable } from "./chatResultTypes";
import { sectionsToBlocks } from "./chatResultTypes";
import { formatMoney, type DocumentType } from "@/engines/documents/document-editor";
import { DOC_LABELS } from "@/engines/documents/engine";
import { dispatch } from "@/engines/validation/dispatcher";
import { getDocumentDetail } from "@/services/canonical/document-detail";
import type { CanonicalDocumentDetail } from "@/services/canonical/read-model";
import { emitExecutionEvent } from "@/core/runtime/trace";

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

export function isDocumentReadOnlyIntent(message: string): boolean {
  return documentIntentType(message) !== null && !isFinanceIntent(message) && !timelineIntentName(message);
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

class ReaderFailure extends Error {
  constructor(
    readonly code: "QUERY_FAILED" | "ACCESS_DENIED",
    readonly sourceReference: string,
    readonly httpStatus?: number,
  ) {
    super(code === "ACCESS_DENIED" ? "ไม่มีสิทธิ์อ่านข้อมูลนี้" : "อ่านข้อมูลจาก Business API ไม่สำเร็จ");
  }
}

async function proxyJson<T>(req: Request, path: string): Promise<T> {
  const toolId = `GET ${path}`;
  const sourceReference = path.split("?")[0];
  emitExecutionEvent({ event: "tool.selected", toolId, sourceReference, status: "selected" });
  const startedAt = Date.now();
  emitExecutionEvent({ event: "reader.started", toolId, sourceReference, status: "started" });
  try {
    const res = await fetch(new URL(path, req.url), {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
    });
    if (!res.ok) {
      const code = res.status === 401 || res.status === 403 ? "ACCESS_DENIED" : "QUERY_FAILED";
      throw new ReaderFailure(code, sourceReference, res.status);
    }
    let data: T;
    try {
      data = (await res.json()) as T;
    } catch {
      throw new ReaderFailure("QUERY_FAILED", sourceReference, res.status);
    }
    if (data && typeof data === "object" && "ok" in data && data.ok === false) {
      throw new ReaderFailure("QUERY_FAILED", sourceReference, res.status);
    }
    emitExecutionEvent({
      event: "reader.completed",
      toolId,
      sourceReference,
      status: "completed",
      durationMs: Date.now() - startedAt,
    });
    return data;
  } catch (error) {
    emitExecutionEvent({
      event: "reader.completed",
      toolId,
      sourceReference,
      status: "failed",
      durationMs: Date.now() - startedAt,
    });
    if (error instanceof ReaderFailure) throw error;
    throw new ReaderFailure("QUERY_FAILED", sourceReference);
  }
}

function dispatchFailure(command: string, violations: string[]): ChatResult {
  const accessDenied = violations.some((violation) =>
    /DATA_SCOPE_REQUIRED|NO_VERIFIED_ACTOR|ปฏิเสธ|ไม่มีสิทธิ์/i.test(violation),
  );
  const queryFailed = violations.some((violation) => /^query error:/i.test(violation));
  const code = accessDenied ? "ACCESS_DENIED" : queryFailed ? "QUERY_FAILED" : "INVALID_REQUEST";
  return {
    type: "error",
    code,
    sourceReference: `registry/command-registry.json#${command}`,
    message: code === "ACCESS_DENIED"
      ? "บัญชีนี้ไม่มีสิทธิ์อ่านข้อมูลที่ร้องขอ"
      : code === "QUERY_FAILED"
        ? "อ่านข้อมูลจาก Canonical Reader ไม่สำเร็จ"
        : "คำสั่งอ่านข้อมูลไม่ผ่านการตรวจสอบ",
  };
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
  if (!fin.ok) throw new ReaderFailure("QUERY_FAILED", "/api/admin/finance-summary", 200);
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

// ── document ────────────────────────────────────────────────────────────────

type DocRow = {
  id?: string;
  document_type?: string;
  document_number?: string;
  issue_date?: string | null;
  party_name?: string;
  net_amount?: number;
};

const DOC_COLUMNS: ResultTable["columns"] = [
  { key: "no", label: "เลขเอกสาร" },
  { key: "date", label: "วันที่" },
  { key: "party", label: "ลูกค้า/คู่ค้า" },
  { key: "amt", label: "ยอด" },
];

function documentNumberFromMessage(message: string): string | null {
  // Covers the real document-number shapes in this system: INV-D10-20260922012005,
  // REC-20260805-812, QT-2026… (leading letters, 1–4 dash-separated segments of
  // letters/digits). Requires a LETTER-led token so a date like 2026-09-22 can
  // never be mistaken for a document number.
  const m = message.match(/\b([A-Za-z]{1,6}(?:-[A-Za-z0-9]+){1,4})\b/);
  return m ? m[1] : null;
}

async function documentResult(
  req: Request,
  docType: DocumentType,
  message: string,
): Promise<ChatResult | null> {
  // READ through the dispatcher (owner ข้อ 3): registry-gated command, input
  // validated, no write path — never a POST/write route.
  const listResult = await dispatch("document.list", {});
  if (!listResult.ok) return dispatchFailure("document.list", listResult.violations);
  if (!Array.isArray(listResult.data)) return dispatchFailure("document.list", ["invalid reader response"]);
  const matches = (listResult.data as DocRow[]).filter(
    (d) => String(d.document_type ?? "").toLowerCase() === docType,
  );
  if (matches.length === 0) {
    return {
      type: "table",
      title: `ไม่พบ${DOC_LABELS[docType]?.th ?? "เอกสาร"} (อ่านสำเร็จ ไม่มีรายการ)`,
      table: { columns: DOC_COLUMNS, rows: [] },
    };
  }

  // (owner 2026-10-08): NEVER auto-pick the first match. If the message names
  // a document number, open exactly that one; if exactly one match exists,
  // open it; otherwise return a picker table so the human chooses.
  const wantedNumber = documentNumberFromMessage(message);
  let doc: DocRow | undefined;
  if (wantedNumber) doc = matches.find((d) => String(d.document_number ?? "") === wantedNumber);
  else if (matches.length === 1) doc = matches[0];
  if (!doc) {
    return {
      type: "table",
      title: `พบ ${matches.length} ฉบับ — ระบุเลขเอกสารในข้อความถัดไปเพื่อเปิดฉบับที่ต้องการ`,
      table: {
        columns: DOC_COLUMNS,
        rows: matches.slice(0, 20).map((d) => [
          String(d.document_number ?? "—"),
          String(d.issue_date ?? "—"),
          String(d.party_name ?? "—"),
          d.net_amount === null || d.net_amount === undefined ? "—" : formatMoney(Number(d.net_amount)),
        ]),
      },
    };
  }
  if (!doc.id) {
    return { type: "error", code: "QUERY_FAILED", message: "รายการเอกสารไม่มีรหัสต้นทาง", sourceReference: "engines/validation/dispatcher.ts#document.list" };
  }

  // (owner ข้อ 4): read the ORIGINAL persisted document — getDocumentDetail()
  // pulls document_versions (snapshot) + document_artifacts (files) exactly as
  // stored. generateDoc() is deliberately NOT called here anymore.
  const kind = docType === "invoice" ? "invoice" : "standalone_document";
  const detailToolId = "canonical.document-detail";
  const detailSource = "services/canonical/document-detail.ts#getDocumentDetail";
  emitExecutionEvent({ event: "tool.selected", toolId: detailToolId, sourceReference: detailSource, status: "selected" });
  const detailStartedAt = Date.now();
  emitExecutionEvent({ event: "reader.started", toolId: detailToolId, sourceReference: detailSource, status: "started" });
  let detail: CanonicalDocumentDetail | null;
  try {
    detail = await getDocumentDetail(kind, doc.id);
  } catch {
    emitExecutionEvent({
      event: "reader.completed",
      toolId: detailToolId,
      sourceReference: detailSource,
      status: "failed",
      durationMs: Date.now() - detailStartedAt,
    });
    throw new ReaderFailure("QUERY_FAILED", detailSource);
  }
  emitExecutionEvent({
    event: "reader.completed",
    toolId: detailToolId,
    sourceReference: detailSource,
    status: "completed",
    durationMs: Date.now() - detailStartedAt,
  });
  if (!detail) {
    return {
      type: "table",
      title: "ไม่พบเอกสารต้นฉบับที่เลือก",
      table: { columns: DOC_COLUMNS, rows: [] },
    };
  }

  // Open the REAL file — only artifacts belonging to the version this reader
  // actually selected (highest version_no, as returned in detail.version) —
  // never another version's file. newest created_at wins because that is the
  // latest produced file OF THAT VERSION (not "first row of a search").
  const versionId = detail.version?.id ?? null;
  const versionArtifacts = versionId
    ? detail.generated_artifacts.filter((a) => String(a.document_version_id ?? "") === versionId)
    : [];
  const artifact =
    versionArtifacts.length > 0
      ? [...versionArtifacts].sort((a, b) =>
          String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
        )[0]
      : null;
  if (artifact?.storage_path) {
    // The file opens through /api/admin/upload?path=… which re-checks
    // requireAuth(ADMIN_TIER) before minting the short-lived signed URL —
    // permission is enforced at open-time, not trusted from this payload.
    return {
      type: "file",
      name: `${doc.document_number || detail.identity.document_no || "เอกสาร"}_${String(artifact.kind ?? "file")}`,
      path: String(artifact.storage_path),
      mime: String(artifact.mime_type ?? "application/octet-stream"),
      size: Number(artifact.size_bytes ?? 0),
    };
  }

  // No stored file for this version → honest DATA SUMMARY, clearly labelled
  // as a summary of the version snapshot — never presented as the original file.
  const label = DOC_LABELS[docType]?.th ?? "เอกสาร";
  const html = renderCanonicalDetailHtml(detail);
  return {
    type: "document",
    title: `${label} ${doc.document_number ?? detail.identity.document_no ?? ""} — สรุปข้อมูลจาก version snapshot (ไม่ใช่ไฟล์ต้นฉบับ)`.trim(),
    html,
  };
}

// ── canonical detail → read-only HTML (version snapshot ต้นฉบับ) ─────────────

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function renderCanonicalDetailHtml(detail: CanonicalDocumentDetail): string {
  const id = detail.identity;
  const f = detail.financials;
  const money = (n: number | null | undefined): string =>
    n === null || n === undefined || Number.isNaN(Number(n)) ? "—" : formatMoney(Number(n));
  const head = `<table style="width:100%;border-collapse:collapse;margin-bottom:12px">
    <tr><td style="padding:4px 8px;color:#888">เลขเอกสาร</td><td><b>${esc(id.document_no ?? "—")}</b></td>
        <td style="padding:4px 8px;color:#888">ประเภท</td><td>${esc(id.document_type)}</td></tr>
    <tr><td style="padding:4px 8px;color:#888">สถานะ</td><td>${esc(id.document_status ?? "—")}</td>
        <td style="padding:4px 8px;color:#888">บันทึกเมื่อ</td><td>${esc((id.created_at ?? "").slice(0, 10) || "—")}</td></tr></table>`;
  const completeness =
    f.data_completeness === "LEGACY_PARTIAL"
      ? `<p style="color:#b26a00">เอกสารฉบับนี้เก็บแบบ LEGACY_PARTIAL — แสดงเฉพาะค่าที่มีจริงใน version snapshot (ไม่เดา ไม่คำนวณใหม่)</p>`
      : "";
  const items =
    detail.line_items_source === "unavailable" || detail.line_items.length === 0
      ? `<p style="color:#888">ไม่มีรายการบรรทัดใน version snapshot (line_items_source: ${esc(detail.line_items_source)})</p>`
      : `<table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #ccc">
          <th style="text-align:left;padding:4px">รายการ</th><th style="text-align:right;padding:4px">จำนวน</th>
          <th style="text-align:left;padding:4px">หน่วย</th><th style="text-align:right;padding:4px">ราคา/หน่วย</th>
        </tr></thead><tbody>${detail.line_items
          .map(
            (it, i) => `<tr style="border-bottom:1px solid #eee">
              <td style="padding:4px">${esc(it.description ?? it.item_description ?? `รายการ ${i + 1}`)}</td>
              <td style="text-align:right;padding:4px">${esc(it.qty ?? it.quantity ?? "—")}</td>
              <td style="padding:4px">${esc(it.unit ?? it.unit_label ?? "—")}</td>
              <td style="text-align:right;padding:4px">${money(Number(it.unit_price ?? it.price ?? NaN))}</td></tr>`,
          )
          .join("")}</tbody></table>`;
  const totals = `<table style="width:100%;border-collapse:collapse;margin-top:12px">
    <tr><td style="padding:3px 8px;color:#888">ก่อน VAT</td><td style="text-align:right">${money(f.subtotal)}</td>
        <td style="padding:3px 8px;color:#888">VAT</td><td style="text-align:right">${money(f.vat_amount)}</td></tr>
    <tr><td style="padding:3px 8px;color:#888">WHT</td><td style="text-align:right">${money(f.wht_amount)}</td>
        <td style="padding:3px 8px;color:#888">ยอดสุทธิ (${esc(f.receivable_basis)})</td><td style="text-align:right"><b>${money(f.net_payable ?? f.gross_amount ?? f.total_amount_persisted)}</b></td></tr>
    <tr><td style="padding:3px 8px;color:#888">ชำระแล้ว</td><td style="text-align:right">${money(f.paid_amount)}</td>
        <td style="padding:3px 8px;color:#888">คงเหลือ</td><td style="text-align:right">${money(f.outstanding)}</td></tr></table>`;
  const artifacts = detail.generated_artifacts.length
    ? `<p style="margin-top:10px"><b>ไฟล์ต้นฉบับที่บันทึกไว้ (document_artifacts):</b><ul>${detail.generated_artifacts
        .map(
          (a) =>
            `<li>${esc(a.kind ?? "file")} — ${esc(a.mime_type ?? "unknown")}${a.size_bytes ? ` (${esc(a.size_bytes)} bytes)` : ""} · version ${esc(a.document_version_id ?? "—")}</li>`,
        )
        .join("")}</ul></p>`
    : "";
  return `<div style="font-family:sans-serif">${completeness}${head}${items}${totals}${artifacts}</div>`;
}

// ── timeline ────────────────────────────────────────────────────────────────

async function timelineResult(_req: Request, name: string): Promise<Extract<ChatResult, { type: "timeline" }> | ChatResult | null> {
  // READ through the dispatcher (owner ข้อ 3) — both commands are registry-
  // declared read commands with real QUERY_MAP handlers; no write path.
  const findResult = await dispatch("partner.find", { keyword: name });
  if (!findResult.ok) return dispatchFailure("partner.find", findResult.violations);
  if (!Array.isArray(findResult.data)) return dispatchFailure("partner.find", ["invalid reader response"]);
  type PartnerRow = { id?: string; name?: string };
  const found = findResult.data as PartnerRow[];
  if (found.length === 0) {
    return {
      type: "table",
      title: "ไม่พบคู่ค้าที่ตรงกัน (อ่านสำเร็จ ไม่มีรายการ)",
      table: { columns: [{ key: "status", label: "สถานะ" }], rows: [] },
    };
  }

  // (owner 2026-10-08): NEVER auto-pick the first partner. Exact full-name
  // match wins; otherwise hand the human a picker table to choose.
  let partner: PartnerRow | undefined;
  const exact = found.filter((p) => String(p.name ?? "").trim() === name.trim());
  if (exact.length === 1) partner = exact[0];
  else if (found.length === 1) partner = found[0];
  if (!partner) {
    return {
      type: "table",
      title: `พบ ${found.length} รายที่ตรงกับ "${name}" — ระบุชื่อเต็มเพื่อดูประวัติ`,
      table: {
        columns: [{ key: "name", label: "ชื่อ" }],
        rows: found.slice(0, 20).map((p) => [String(p.name ?? "—")]),
      },
    };
  }
  if (!partner.id) {
    return { type: "error", code: "QUERY_FAILED", message: "รายการคู่ค้าไม่มีรหัสต้นทาง", sourceReference: "engines/validation/dispatcher.ts#partner.find" };
  }
  const tl = await dispatch("partner.timeline", { partner_id: String(partner.id) });
  if (!tl.ok) return dispatchFailure("partner.timeline", tl.violations);
  if (!tl.data || typeof tl.data !== "object") return dispatchFailure("partner.timeline", ["invalid reader response"]);
  const data = tl.data as {
    summary: Extract<ChatResult, { type: "timeline" }>["summary"];
    timeline: Extract<ChatResult, { type: "timeline" }>["items"];
  };
  return { type: "timeline", title: `ประวัติ ${partner.name ?? name}`, summary: data.summary ?? null, items: data.timeline ?? [] };
}

// ── local AI command → canonical render paths เดิม ──────────────────────────
// (LOCAL AI RUNTIME mission, 2026-10-11) — ไม่มี renderer/data path ใหม่:
// finance/timeline/document ใช้ function เดิมของไฟล์นี้ · ที่เหลือวิ่งผ่าน
// engines/validation/dispatcher (registry-gated read command) แล้วแสดงตาราง

async function dispatcherTableResult(
  command: string,
  payload: Record<string, unknown>,
): Promise<ChatResult | null> {
  const r = await dispatch(command, payload);
  if (!r.ok) return dispatchFailure(command, r.violations);
  if (!Array.isArray(r.data)) return dispatchFailure(command, ["invalid reader response"]);
  // ผลอ่านสำเร็จแต่ไม่มีรายการ → แสดงตารางว่างตรง ๆ (ซื่อสัตย์ว่าอ่านแล้วจริง)
  // ไม่ใช่ null (กัน fallback ไปแปลงเป็นคำตอบอย่างอื่น)
  if (r.data.length === 0) {
    return {
      type: "table",
      title: `${command} — อ่านจาก canonical dispatcher (ไม่มีรายการ)`,
      table: { columns: [{ key: "status", label: "สถานะ" }], rows: [["ไม่มีรายการ"]] },
    };
  }
  const rows = (r.data as Record<string, unknown>[]).slice(0, 20);
  const keys = Object.keys(rows[0])
    .filter((k) => rows[0][k] === null || typeof rows[0][k] !== "object")
    .slice(0, 6);
  if (keys.length === 0) return null;
  return {
    type: "table",
    title: `${command} — อ่านจาก canonical dispatcher (${r.data.length} รายการ)`,
    table: {
      columns: keys.map((k) => ({ key: k, label: k })),
      rows: rows.map((row) => keys.map((k) => (row[k] === null || row[k] === undefined ? "—" : String(row[k])))),
    },
  };
}

async function localAiCommandResult(
  req: Request,
  message: string,
  cmd: import("./localAiBridge").LocalAiCommand,
): Promise<ChatResult | null> {
  switch (cmd.action) {
    case "finance.summary":
      return financeResult(req);
    case "partner.timeline": {
      const name = String(cmd.payload.name ?? "").trim();
      return name ? timelineResult(req, name) : null;
    }
    case "document.list": {
      const valid: DocumentType[] = ["invoice", "receipt", "quotation", "purchase_order", "delivery_order", "payment_voucher", "debt_notice"];
      const type = valid.find((v) => v === String(cmd.payload.type ?? "")) ?? null;
      return type ? documentResult(req, type, message) : null;
    }
    case "job.active":
      return dispatcherTableResult("job.active", {});
    case "job.list":
      return dispatcherTableResult("job.list", {});
    case "draft.list":
      return dispatcherTableResult("draft.list", {});
    case "debt.list":
      return dispatcherTableResult("debt.list", {});
    case "invoice.latest":
      return dispatcherTableResult("invoice.latest", {});
    default:
      return null;
  }
}

// ── entry ───────────────────────────────────────────────────────────────────

type PipelineLike = {
  text?: string;
  confirm_token?: string;
  confirm_action?: string;
  flex_preview?: unknown;
  doc_html?: string;
  workspace?: { sections?: ResultSectionLike[] };
};

export async function buildChatResult(
  req: Request,
  message: string,
  pipeline: PipelineLike,
  localCommand?: import("./localAiBridge").LocalAiCommand | null,
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
  // Existing board sections remain the fallback only when no canonical reader answers.
  const sectionBlocks = pipeline.workspace?.sections?.length
    ? sectionsToBlocks(pipeline.workspace.sections)
    : [];
  try {
    // LOCAL AI intent bridge (LOCAL AI RUNTIME mission, 2026-10-11): command
    // ที่ Local AI แปลได้มาก่อนหน้า เข้าสู่ path canonical เดิมตัวนี้โดยตรง
    // (finance_result / timeline_result / document_result / dispatcher) —
    // ไม่มี renderer ใหม่ ไม่มี data path ใหม่
    if (localCommand) {
      const r = await localAiCommandResult(req, message, localCommand);
      if (r) return r;
    }
    if (isFinanceIntent(message)) {
      const r = await financeResult(req);
      if (r) return r;
    }
    const name = timelineIntentName(message);
    if (name) {
      const r = await timelineResult(req, name);
      if (r) return r;
    }
    const docType = documentIntentType(message);
    if (docType) {
      const r = await documentResult(req, docType, message);
      if (r) return r;
    }
  } catch (error) {
    if (error instanceof ReaderFailure) {
      return {
        type: "error",
        code: error.code,
        message: error.message,
        sourceReference: error.sourceReference,
      };
    }
    return {
      type: "error",
      code: "QUERY_FAILED",
      message: "อ่านข้อมูลจาก Canonical Reader ไม่สำเร็จ",
      sourceReference: "app/api/chat/_lib/resultContract.ts#buildChatResult",
    };
  }
  if (sectionBlocks.length) return { type: "sections", blocks: sectionBlocks };
  return null;
}
