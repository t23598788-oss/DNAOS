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
import type { VerifiedScope } from "@/core/auth/orgScope";

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
  scope?: VerifiedScope | null,
): Promise<ChatResult | null> {
  // READ through the dispatcher (owner ข้อ 3): registry-gated command, input
  // validated, no write path — never a POST/write route.
  const listResult = await dispatch("document.list", {}, false, { scope });
  if (!listResult.ok || !Array.isArray(listResult.data)) return null;
  const matches = (listResult.data as DocRow[]).filter(
    (d) => String(d.document_type ?? "").toLowerCase() === docType,
  );
  if (matches.length === 0) return null;

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
  if (!doc.id) return null;

  // (owner ข้อ 4): read the ORIGINAL persisted document — getDocumentDetail()
  // pulls document_versions (snapshot) + document_artifacts (files) exactly as
  // stored. generateDoc() is deliberately NOT called here anymore.
  const kind = docType === "invoice" ? "invoice" : "standalone_document";
  const detail = await getDocumentDetail(kind, doc.id);
  if (!detail) return null;

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

// ── layer evidence (LOCAL AI BUSINESS COMMAND PATH, owner 2026-10-17) ────────
// หลักฐานการทำงานแต่ละชั้น — ค่าทั้งหมดมาจากเส้นทางจริงที่กำลังรันเท่านั้น
// (ไม่ประดิษฐ์สถานะ): dispatch ที่จับได้ ใส่ทั้ง TOOL/DISPATCHER/DATABASE ไว้เลย
export interface LayerTrace {
  input?: Record<string, unknown>;
  ai?: Record<string, unknown>;
  tool?: Record<string, unknown>;
  dispatcher?: Record<string, unknown>;
  database?: Record<string, unknown>;
  result?: Record<string, unknown>;
  workspace?: Record<string, unknown>;
}

/** หลักฐาน DATABASE layer: reader เดิมของแต่ละ command จาก QUERY_MAP เดิม
 * (ห้ามหลอกว่าระบบมาจากตารางอื่น) — dispatcher คือเจ้าเดียวที่เรียกมัน */
export const STYLE_CHAIN_DB_READERS: Record<string, string> = {
  "partner.find": "services/supabase/queries#getPartners (company table — canonical reader เดิม)",
  "debt.current": "engines/debt/tracking#getCurrentDebt (debt_snapshots + debt_events — canonical reader เดิม)",
  "debt.list": "services/supabase/queries#getOpenDebts (invoice_payment_summary + invoices — canonical view เดิม)",
  "job.active": "services/supabase/queries#getJobs (jobs IN_PROGRESS)",
  "job.list": "services/supabase/queries#getJobs",
  "draft.list": "services/supabase/queries#getPendingDrafts",
  "invoice.latest": "services/supabase/queries#getLatestInvoice",
};

async function dispatchWithTrace(
  command: string,
  payload: Record<string, unknown>,
  trace?: LayerTrace,
  scope?: VerifiedScope | null,
) {
  const r = await dispatch(command, payload, false, { scope });
  if (trace) {
    trace.tool = { ...trace.tool, last_command: command };
    trace.dispatcher = {
      command,
      ok: r.ok,
      violations: r.violations ?? [],
      requires_confirmation: r.requires_confirmation,
      code: r.code ?? null,
      surface: r.surface ?? null,
      hardcode_warnings: Array.isArray(r.hardcode_warnings) ? r.hardcode_warnings.length : 0,
    };
    trace.database = { reader: STYLE_CHAIN_DB_READERS[command] ?? "canonical dispatcher QUERY_MAP" };
  }
  return r;
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

async function timelineResult(_req: Request, name: string, scope?: VerifiedScope | null): Promise<Extract<ChatResult, { type: "timeline" }> | ChatResult | null> {
  // READ through the dispatcher (owner ข้อ 3) — both commands are registry-
  // declared read commands with real QUERY_MAP handlers; no write path.
  const findResult = await dispatch("partner.find", { keyword: name }, false, { scope });
  if (!findResult.ok || !Array.isArray(findResult.data)) return null;
  type PartnerRow = { id?: string; name?: string };
  const found = findResult.data as PartnerRow[];
  if (found.length === 0) return null;

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
  if (!partner.id) return null;
  const tl = await dispatch("partner.timeline", { partner_id: String(partner.id) }, false, { scope });
  if (!tl.ok || !tl.data || typeof tl.data !== "object") return null;
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
  trace?: LayerTrace,
  scope?: VerifiedScope | null,
): Promise<ChatResult | null> {
  const r = await dispatchWithTrace(command, payload, trace, scope);
  if (!r.ok || !Array.isArray(r.data)) return null;
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

// ── debt.current (หนี้ของบริษัทเจาะจง) — LOCAL AI BUSINESS COMMAND PATH ────
// (owner, 2026-10-17) เส้นทาง canonical เดิมทั้งหมด: partner.find (ค้นชื่อบริษัท
// → id เดียว) → debt.current (ส่งตัวตน partner_id ติดเข้าสู่ GetCurrentDebt) →
// debt.list (เลขที่เอกสารของใบแจ้งหนี้ค้างบริษัทเดียวกัน เมื่อมี) · ไม่สร้าง Reader
// / Writer คู่ขนาน · แสดงเท่านั้นข้อมูลจริง: ชื่อบริษัท / เลขที่เอกสาร / ยอดหนี้ /
// สถานะ — ไม่มีข้อมูล → NOT_FOUND ไม่มีสิทธิ์ → BLOCKED (ไม่แต่งตัวเลข)

async function companyDebtResult(companyName: string, trace?: LayerTrace, scope?: VerifiedScope | null): Promise<ChatResult | null> {
  // ชั้น 1 — TOOL: partner.find (registry command ที่ลงทะเบียนไว้) → ตัวตนบริษัท
  const findResult = await dispatchWithTrace("partner.find", { keyword: companyName }, trace, scope);
  if (!findResult.ok) {
    if (trace) trace.result = { status: "BLOCKED", command: "partner.find", violations: findResult.violations ?? [] };
    return {
      type: "table",
      title: `ยอดหนี้ของ "${companyName}" — BLOCKED`,
      table: {
        columns: [
          { key: "company", label: "บริษัท" },
          { key: "doc", label: "เลขที่เอกสาร" },
          { key: "amount", label: "ยอดหนี้ (คงชำระ)" },
          { key: "status", label: "สถานะ" },
        ],
        rows: [[companyName, "—", "—", `BLOCKED: ${(findResult.violations ?? []).join("; ") || "dispatcher ปฏิเสธ"}`]],
      },
    };
  }
  type PartnerRow = { id?: string; name?: string };
  let found = (Array.isArray(findResult.data) ? findResult.data : []) as PartnerRow[];
  let identityFallback: string[] | null = null;
  if (found.length === 0) {
    // IDENTITY FALLBACK (close-text Thai, presentation layer เท่านั้น): ชื่อที่
    // พิมพ์ผิดอักษรกลมกลืน (ท/ธ, ฒ/ช — ของจริง: "ช.ทวัฒชัยการช่าง" vs "ช.ธวัชชัยการช่าง")
    // ลองตัวแปรแล้วใช้ guard เดิม (ชื่อเต็มตรงหรือผลลัพธ์เดียวเท่านั้น) และชื่อที่
    // แสดงบนจอเป็นชื่อจาก DB จริงเสมอ — dispatcher/registry/ข้อมูลไม่ถูกแตะ
    const variants = thaiCloseVariants(companyName);
    for (const v of variants) {
      const alt = await dispatchWithTrace("partner.find", { keyword: v }, trace, scope);
      if (alt.ok && Array.isArray(alt.data) && (alt.data as PartnerRow[]).length > 0) {
        found = alt.data as PartnerRow[];
        identityFallback = variants.slice(0, variants.indexOf(v) + 1);
        break;
      }
    }
  }
  if (found.length === 0) {
    if (trace) trace.result = { status: "NOT_FOUND", command: "partner.find", keyword: companyName, variants_tried: thaiCloseVariants(companyName) };
    return {
      type: "table",
      title: `ยอดหนี้ของ "${companyName}"`,
      table: {
        columns: [
          { key: "company", label: "บริษัท" },
          { key: "doc", label: "เลขที่เอกสาร" },
          { key: "amount", label: "ยอดหนี้ (คงชำระ)" },
          { key: "status", label: "สถานะ" },
        ],
        rows: [[companyName, "—", "—", "NOT_FOUND — ไม่พบบริษัทนี้ในระบบ"]],
      },
    };
  }
  const exact = found.filter((p) => String(p.name ?? "").trim() === companyName.trim());
  const partner = exact.length >= 1 ? exact[0] : found.length === 1 ? found[0] : undefined;
  if (!partner?.id) {
    return {
      type: "table",
      title: `พบ ${found.length} รายที่ตรงกับ "${companyName}" — ระบุชื่อบริษัทให้ตรงเพื่อดูยอดหนี้`,
      table: {
        columns: [{ key: "name", label: "ชื่อบริษัท" }],
        rows: found.slice(0, 20).map((p) => [String(p.name ?? "—")]),
      },
    };
  }

  // ชั้น 2 — TOOL: debt.current ผ่านตัวตนเดิมจาก partner.find (Canonical เดิม)
  const debtResult = await dispatchWithTrace("debt.current", { partner_id: String(partner.id) }, trace, scope);
  if (!debtResult.ok) {
    if (trace) trace.result = { status: "BLOCKED", command: "debt.current", violations: debtResult.violations ?? [] };
    return {
      type: "table",
      title: `ยอดหนี้ของ "${String(partner.name ?? companyName)}"`,
      table: {
        columns: [
          { key: "company", label: "บริษัท" },
          { key: "doc", label: "เลขที่เอกสาร" },
          { key: "amount", label: "ยอดหนี้ (คงชำระ)" },
          { key: "status", label: "สถานะ" },
        ],
        rows: [[String(partner.name ?? companyName), "—", "—", `BLOCKED: ${(debtResult.violations ?? []).join("; ") || "dispatcher ปฏิเสธ"}`]],
      },
    };
  }
  const debt = debtResult.data as {
    principal?: number | null;
    interest?: number | null;
    penalty?: number | null;
    total_due?: number | null;
    overdue_days?: number | null;
    debt_type?: string | null;
    document_type?: string | null;
  } | null;
  if (!debt || !debt.total_due) {
    if (trace) trace.result = { status: "NOT_FOUND", command: "debt.current", partner_id: String(partner.id), identity_fallback: identityFallback };
    return {
      type: "table",
      title: `ยอดหนี้ของ "${String(partner.name ?? companyName)}"`,
      table: {
        columns: [
          { key: "company", label: "บริษัท" },
          { key: "doc", label: "เลขที่เอกสาร" },
          { key: "amount", label: "ยอดหนี้ (คงชำระ)" },
          { key: "status", label: "สถานะ" },
        ],
        rows: [[String(partner.name ?? companyName), "—", "—", "NOT_FOUND — ไม่มีข้อมูลหนี้ค้างของบริษัทนี้ในระบบ"]],
      },
    };
  }

  // ชั้น 3 — เลขที่เอกสาร: จาก canonical view เดิม (debt.list = invoice_payment_summary)
  // เฉพาะแถวของบริษัทนี้เท่านั้น (เทียบชื่อเต็มจาก partner.find — ข้อมูลจริงเท่านั้น)
  const debtList = await dispatchWithTrace("debt.list", {}, trace, scope);
  type OpenDebtRow = { document_number?: string | null; customer_name?: string | null; outstanding_amount?: number | null; derived_status?: string | null };
  const companyInvoices = (Array.isArray(debtList?.data) ? (debtList.data as OpenDebtRow[]) : [])
    .filter((d) => String(d.customer_name ?? "").trim() === String(partner.name ?? '').trim());
  const docNumbers = [...new Set(companyInvoices.map((d) => String(d.document_number ?? "").trim()).filter(Boolean))];

  const status = overdueStatusLabel(debt.overdue_days, debt.debt_type);
  if (trace) {
    trace.result = {
      status: "OK",
      partner_id: String(partner.id),
      total_due: debt.total_due,
      overdue_days: debt.overdue_days ?? null,
      invoices_matched: companyInvoices.length,
      identity_fallback: identityFallback,
    };
    trace.workspace = {
      renders_as: "table (field-group: บริษัท/เลขที่เอกสาร/ยอดหนี้/สถานะ)",
      client_gap: "app/admin/ui-gallery/_lib/BusinessDisplayRenderer.tsx — same DisplayBlock as other canonical tables",
    };
  }
  return {
    type: "table",
    title: `ยอดหนี้ของ "${String(partner.name ?? companyName)}"`,
    table: {
      columns: [
        { key: "company", label: "บริษัท" },
        { key: "doc", label: "เลขที่เอกสาร" },
        { key: "amount", label: "ยอดหนี้ (คงชำระ)" },
        { key: "status", label: "สถานะ" },
      ],
      rows: docNumbers.length > 0
        ? docNumbers.slice(0, 20).map((no) => [
            String(partner.name ?? "—"),
            no,
            formatMoney(Number(debt.total_due)),
            status,
          ])
        : [[
            String(partner.name ?? "—"),
            "—",
            formatMoney(Number(debt.total_due)),
            status,
          ]],
    },
  };
}

// ตัวแปรชื่อบริษัทแบบปิด (ใช้เข้า partner.find เท่านั้น — ไม่แสดงบนจอ)
// อักษรกลมกลืนไทยที่พิมพ์สับสนกันได้จริง: ท/ธ และ ฒ/ช
function thaiCloseVariants(name: string): string[] {
  // ใช้แทนที่อักษรทีละตัว (parallel) — การแทนที่นเรียงลำดับจะย้อนค่าที่แทนกลับ (ท→ธ โดน ธ→ท)
  const pairs = new Map<string, string>([["ท", "ธ"], ["ธ", "ท"], ["ฒ", "ช"]]);
  const out = new Set<string>();
  for (const [k, v] of pairs) {
    if (name.includes(k)) out.add(name.split(k).join(v));
  }
  const combined = [...name].map((ch) => pairs.get(ch) ?? ch).join("");
  if (combined !== name && Object.keys(Object.fromEntries(pairs)).some((k) => name.includes(k))) out.add(combined);
  out.delete(name);
  return [...out].slice(0, 6);
}

function overdueStatusLabel(overdueDays: unknown, debtType: unknown): string {
  const d = Number(overdueDays ?? 0);
  const type = String(debtType ?? "");
  const base = d > 0 ? `ค้างชำระเกินกำหนด ${d} วัน` : "ค้างชำระ";
  if (type === "loan") return `${base} · ประเภท: เงินกู้`;
  if (type === "damages") return `${base} · ประเภท: ชดใช้ค่าเสียหาย`;
  if (type === "collection_reminder") return `${base} · ประเภท: หนี้ค่าเก็บหนี้`;
  return base; // trade_receivable เป็นค่าเริ่มต้นของ debt_snapshots — ไม่ต้องติดป้ายจากการเดา
}

// ── debt.list → ตารางธุรกิจภาษาไทย (FIELD GAPS owner mission 2026-10-15) ──
// เส้นทางเดิม: dispatch("debt.list") (canonical reader เดิม) → เสนอแมพเข้า
// Dynamic Table Renderer เดิมของ workspace (type "table") — ไม่มี renderer ใหม่
// ไม่มี data path ใหม่ · เห็นเท่านั้นฟิลด์จริง: เลขที่ใบแจ้งหนี้ / บริษัท / ยอดค้างชำระ /
// วันที่ / สถานะ — ไม่มี UUID, JSON, หรือชื่อคำสั่งภายในบนจอ

const DEBT_COLUMNS: ResultTable["columns"] = [
  { key: "invoice_no", label: "เลขที่ใบแจ้งหนี้" },
  { key: "company", label: "บริษัท" },
  { key: "outstanding", label: "ยอดค้างชำระ" },
  { key: "date", label: "วันที่" },
  { key: "status", label: "สถานะ" },
];

function debtStatusLabel(derived: unknown): string {
  const D = String(derived ?? "");
  if (D === "PARTIALLY_PAID") return "ชำระบางส่วน";
  if (D === "UNKNOWN") return "ยังไม่ระบุสถานะ";
  if (D === "OVERDUE") return "ค้างชำระเกินกำหนด";
  return "ค้างชำระ"; // derived_status ที่ผ่าน getOpenDebts ได้คือรายการค้างเสมอ (ไม่มี PAID/VOID)
}

const nonEmpty = (v: unknown): string => {
  const s = String(v ?? "").trim();
  // กันฟิลด์ identity หลุดขึ้นจอในรูป UUID (เมื่อไรข้อมูลร้องขอไม่มีจริง → เส้นว่างเลย —)
  return s && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : "—";
};

async function debtListResult(trace?: LayerTrace, scope?: VerifiedScope | null): Promise<ChatResult | null> {
  const r = await dispatchWithTrace("debt.list", {}, trace, scope);
  if (!r.ok || !Array.isArray(r.data)) return null;
  const rows = r.data as Record<string, unknown>[];
  return {
    type: "table",
    title: rows.length === 0 ? "หนี้ค้างชำระ — ไม่มีรายการ" : `หนี้ค้างชำระ (${rows.length} รายการ)`,
    table: {
      columns: DEBT_COLUMNS,
      rows: rows.length === 0
        ? [DEBT_COLUMNS.map((_, i) => (i === 0 ? "ไม่มีรายการ" : "—"))]
        : rows.map((d) => [
            nonEmpty(d.document_number),
            nonEmpty(d.customer_name),
            cell(Number(d.outstanding_amount ?? 0)),
            nonEmpty(String(d.issue_date ?? "").slice(0, 10)),
            debtStatusLabel(d.derived_status ?? d.invoice_status),
          ]),
    },
  };
}

async function localAiCommandResult(
  req: Request,
  message: string,
  cmd: import("./localAiBridge").LocalAiCommand,
  trace?: LayerTrace,
  scope?: VerifiedScope | null,
): Promise<ChatResult | null> {
  switch (cmd.action) {
    case "finance.summary":
      return financeResult(req);
    case "partner.timeline": {
      const name = String(cmd.payload.name ?? "").trim();
      return name ? timelineResult(req, name, scope) : null;
    }
    case "document.list": {
      const valid: DocumentType[] = ["invoice", "receipt", "quotation", "purchase_order", "delivery_order", "payment_voucher", "debt_notice"];
      const type = valid.find((v) => v === String(cmd.payload.type ?? "")) ?? null;
      return type ? documentResult(req, type, message, scope) : null;
    }
    case "job.active":
      return dispatcherTableResult("job.active", {}, trace, scope);
    case "job.list":
      return dispatcherTableResult("job.list", {}, trace, scope);
    case "draft.list":
      return dispatcherTableResult("draft.list", {}, trace, scope);
    case "debt.list":
      return debtListResult(trace, scope);
    case "invoice.latest":
      return dispatcherTableResult("invoice.latest", {}, trace, scope);
    case "debt.current": {
      // LOCAL AI BUSINESS COMMAND PATH (owner, 2026-10-17): หนี้ของบริษัทเจาะจง
      // วิ่งผ่าน Canonical Dispatcher เดิมทั้งสาย — partner.find (แปลชื่อบริษัท
      // เป็นตัวตน/identity) → debt.current (partner_id ตัวเดียวกัน) → debt.list
      // (เลขที่เอกสารของใบแจ้งหนี้ค้าง เมื่อมี) — ไม่มี Reader/Writer คู่ขนาน
      const company = String(cmd.payload.company ?? "").trim();
      return company ? companyDebtResult(company, trace, scope) : null;
    }
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
  trace?: LayerTrace,
  scope?: VerifiedScope | null,
): Promise<ChatResult | null> {
  // หลักฐานชั้น INPUT ของเส้นทาง Local AI (ข้อ 5 owner): ข้อความต้นทาง +
  // ตัวตน AI command ที่ถูกแปลได้ (route เติม ai/provenance เอง ในขั้นถัดไป)
  if (trace && localCommand) {
    trace.input = { message: message.slice(0, 400), command: localCommand.action, payload: localCommand.payload };
  }
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
  // board workspace.sections (ของเดิม) — fallback ท้ายสุดถ้า canonical query พลาด
  const sectionBlocks = pipeline.workspace?.sections?.length
    ? sectionsToBlocks(pipeline.workspace.sections)
    : [];
  try {
    // LOCAL AI intent bridge (LOCAL AI RUNTIME mission, 2026-10-11): command
    // ที่ Local AI แปลได้มาก่อนหน้า เข้าสู่ path canonical เดิมตัวนี้โดยตรง
    // (finance_result / timeline_result / document_result / dispatcher) —
    // ไม่มี renderer ใหม่ ไม่มี data path ใหม่
    if (localCommand) {
      const r = await localAiCommandResult(req, message, localCommand, trace, scope);
      if (r) {
        if (trace && !trace.result) {
          trace.result = { status: "OK", renders_as: r.type };
          trace.workspace = { renders_as: r.type, client: "app/admin/ui-gallery/_lib/BusinessDisplayRenderer.tsx" };
        }
        return r;
      }
    }
    if (isFinanceIntent(message)) {
      const r = await financeResult(req);
      if (r) return r;
    }
    const name = timelineIntentName(message);
    if (name) {
      const r = await timelineResult(req, name, scope);
      if (r) return r;
    }
    const docType = documentIntentType(message);
    if (docType) {
      const r = await documentResult(req, docType, message, scope);
      if (r) return r;
    }
  } catch {
    // canonical query ล้มเหลว → ตกไป sections/text (ไม่เดา ไม่แต่ง)
  }
  if (sectionBlocks.length) return { type: "sections", blocks: sectionBlocks };
  return null;
}
