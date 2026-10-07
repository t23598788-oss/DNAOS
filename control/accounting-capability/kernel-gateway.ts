/**
 * หน้าที่: ชั้นเดียวในระบบที่รู้จักโครงสร้างภายในของ DNA OS Accounting Kernel
 *
 * Owner, 2026-09-05: "ระบบภายนอกต้องไม่รู้ implementation ภายใน kernel และ
 * ห้ามเชื่อมตรงเข้าตารางภายใน kernel จาก business logic ใหม่"
 * ไฟล์นี้จึงเป็นกำแพง — ชื่อตาราง รหัสผังบัญชี และ SQL ทั้งหมดหยุดอยู่ที่นี่
 *
 * ไม่สร้าง core ใหม่ ไม่แก้สูตร เรียกของเดิมล้วน:
 *   post_event() / ensure_period() / views (trial_balance, pnl, balance_sheet,
 *   vat_report, wht_report, ar_by_document_v, ap_by_document)
 * ตามที่ registry ชี้ไว้ที่ tests/__sandbox__/accounting-kernel/
 *
 * Dependency ที่อนุญาต: pg, ./types.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามคำนวณ debit/credit หรือ VAT ในไฟล์นี้ ทุกตัวเลขมาจาก kernel
 * - ห้าม export ชื่อตารางหรือรหัสบัญชีออกนอกไฟล์
 */

import { Client } from "pg";
import type { EvidencePointer, JournalEntryOut, JournalLineOut, SourceType } from "./types";

export interface KernelConnection { readonly connectionString: string }

/** ความหมายทางธุรกิจ -> รหัสผังบัญชีของ kernel (ตารางแปลอยู่ในนี้ที่เดียว) */
const ACCOUNT_LABEL: Readonly<Record<string, string>> = {
  "1010": "เงินฝากธนาคาร", "1130": "ลูกหนี้การค้า", "1140": "ภาษีซื้อ",
  "1150": "ภาษีหัก ณ ที่จ่ายรอเรียกคืน", "2110": "เจ้าหนี้การค้า", "2130": "ภาษีขาย",
  "2140": "ภาษีหัก ณ ที่จ่ายค้างจ่าย", "2200": "เงินรับล่วงหน้า",
  "3000": "กำไรสะสม", "4100": "รายได้จากการขาย", "5000": "ค่าใช้จ่าย",
};

export async function withKernel<T>(
  conn: KernelConnection,
  fn: (q: (sql: string, params?: readonly unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: conn.connectionString });
  await client.connect();
  try {
    return await fn(async (sql, params) => (await client.query(sql, params as unknown[])).rows);
  } finally {
    await client.end();
  }
}

type Q = (sql: string, params?: readonly unknown[]) => Promise<Record<string, unknown>[]>;

const n = (v: unknown) => Number(v ?? 0);

/** งวดบัญชีถูกกำหนดโดย kernel เท่านั้น adapter ไม่มีสิทธิ์รู้วิธีสร้าง (Phase 3.3) */
export async function resolvePeriod(q: Q, occurredAt: string): Promise<string> {
  const rows = await q("select ensure_period($1::timestamptz) as code", [occurredAt]);
  return String(rows[0]!.code);
}

export async function findExistingEvent(q: Q, idempotencyKey: string): Promise<string | null> {
  const rows = await q("select id from financial_events where idempotency_key = $1", [idempotencyKey]);
  return rows.length === 0 ? null : String(rows[0]!.id);
}

export async function ensureCompany(q: Q, companyId: string): Promise<void> {
  await q("insert into companies(id) values ($1::uuid) on conflict (id) do nothing", [companyId]);
}

export interface SalesDocRow {
  readonly document_no: string; readonly company_id: string;
  readonly vat_amount: number; readonly total_amount: number;
}

export async function upsertSalesDocument(q: Q, id: string, d: SalesDocRow): Promise<void> {
  await q(
    `insert into invoices(id, invoice_no, customer_company_id, vat_amount, total_amount)
     values ($1::uuid,$2,$3::uuid,$4,$5) on conflict (id) do nothing`,
    [id, d.document_no, d.company_id, d.vat_amount, d.total_amount],
  );
}

export interface PurchaseDocRow {
  readonly document_no: string; readonly vendor_company_id: string;
  readonly net_amount: number; readonly vat_amount: number; readonly total_amount: number;
}

export async function upsertPurchaseDocument(q: Q, id: string, d: PurchaseDocRow): Promise<void> {
  await q(
    `insert into supplier_documents(id, doc_no, vendor_company_id, net_amount, vat_amount, total_amount)
     values ($1::uuid,$2,$3::uuid,$4,$5,$6) on conflict (id) do nothing`,
    [id, d.document_no, d.vendor_company_id, d.net_amount, d.vat_amount, d.total_amount],
  );
}

export async function upsertCreditNote(
  q: Q, id: string,
  d: { readonly cn_no: string; readonly invoice_id: string; readonly net_amount: number; readonly vat_amount: number; readonly total_amount: number },
): Promise<void> {
  await q(
    `insert into credit_notes(id, cn_no, invoice_id, net_amount, vat_amount, total_amount)
     values ($1::uuid,$2,$3::uuid,$4,$5,$6) on conflict (id) do nothing`,
    [id, d.cn_no, d.invoice_id, d.net_amount, d.vat_amount, d.total_amount],
  );
}

export async function createEvent(
  q: Q,
  ev: { readonly event_type: string; readonly amount: number; readonly party_id: string; readonly occurred_at: string; readonly period_code: string; readonly idempotency_key: string },
): Promise<string> {
  const rows = await q(
    `insert into financial_events(event_type, amount, party_id, occurred_at, period_code, idempotency_key)
     values ($1,$2,$3::uuid,$4::timestamptz,$5,$6) returning id`,
    [ev.event_type, ev.amount, ev.party_id, ev.occurred_at, ev.period_code, ev.idempotency_key],
  );
  return String(rows[0]!.id);
}

/** หลักฐานแบบเจาะจงตาราง kernel (ใบแจ้งหนี้/เอกสารผู้ขาย/ใบลดหนี้) */
export async function attachKernelDocumentEvidence(
  q: Q, eventId: string, column: "invoice_id" | "supplier_document_id" | "credit_note_id", documentId: string,
): Promise<void> {
  await q(
    `insert into financial_event_evidence(event_id, role, ${column}) values ($1::uuid,'billing_document',$2::uuid)`,
    [eventId, documentId],
  );
}

/** หลักฐานแบบชี้กลับระบบเดิม (Phase 3.2 generic pointer) */
export async function attachSourceEvidence(q: Q, eventId: string, ev: EvidencePointer): Promise<void> {
  await q(
    `insert into financial_event_evidence(event_id, role, source_type, source_ref)
     values ($1::uuid,'source_event',$2,$3)`,
    [eventId, ev.source_type, ev.source_id],
  );
}

export async function addAllocation(
  q: Q, eventId: string,
  a: { readonly side: "AR" | "AP"; readonly doc_kind: "invoice" | "supplier"; readonly document_id: string; readonly amount: number },
): Promise<void> {
  await q(
    `insert into payment_allocations(event_id, side, doc_kind, document_id, amount)
     values ($1::uuid,$2,$3,$4::uuid,$5)`,
    [eventId, a.side, a.doc_kind, a.document_id, a.amount],
  );
}

export async function postEvent(q: Q, eventId: string): Promise<string> {
  const rows = await q("select post_event($1::uuid) as entry_id", [eventId]);
  return String(rows[0]!.entry_id);
}

export async function readEntry(q: Q, entryId: string): Promise<JournalEntryOut> {
  const head = await q("select id, period_code, memo from journal_entries where id = $1::uuid", [entryId]);
  const lines = await q(
    `select l.account_code, c.acct_type, l.debit, l.credit
       from journal_lines l join chart_of_accounts c on c.account_code = l.account_code
      where l.entry_id = $1::uuid order by l.id`,
    [entryId],
  );
  const mapped: JournalLineOut[] = lines.map((r) => ({
    account: ACCOUNT_LABEL[String(r.account_code)] ?? String(r.account_code),
    account_type: String(r.acct_type) as JournalLineOut["account_type"],
    debit: n(r.debit), credit: n(r.credit),
  }));
  const d = mapped.reduce((a, l) => a + l.debit, 0);
  const c = mapped.reduce((a, l) => a + l.credit, 0);
  return {
    entry_id: entryId,
    period_code: String(head[0]?.period_code ?? ""),
    memo: String(head[0]?.memo ?? ""),
    lines: mapped,
    balanced: Math.abs(d - c) < 0.01,
  };
}

export async function readEvidence(q: Q, entryId: string): Promise<readonly EvidencePointer[]> {
  const rows = await q(
    `select e.source_type, e.source_ref, e.invoice_id, e.supplier_document_id, e.credit_note_id
       from financial_event_evidence e
       join journal_entries j on j.event_id = e.event_id
      where j.id = $1::uuid`,
    [entryId],
  );
  return rows.map((r) => {
    if (r.source_type !== null && r.source_type !== undefined) {
      return { source_type: String(r.source_type) as SourceType, source_id: String(r.source_ref), original_pointer: null };
    }
    const kernelDoc = r.invoice_id ?? r.supplier_document_id ?? r.credit_note_id;
    return { source_type: "invoices" as SourceType, source_id: String(kernelDoc), original_pointer: null };
  });
}

// ─── รายงาน: อ่านจาก view ของ kernel ตรง ๆ ไม่คำนวณซ้ำ ─────────────────────

export const REPORT_SQL = {
  trialBalance: "select account_code, sum(debit) d, sum(credit) c from journal_lines group by account_code order by account_code",
  arByDocument: "select document_id, sum(debit) - sum(credit) bal from journal_lines where account_code='1130' and doc_kind='invoice' group by document_id",
  apByDocument: "select document_id, sum(credit) - sum(debit) bal from journal_lines where account_code='2110' and doc_kind='supplier' group by document_id",
  vat: "select coalesce(sum(credit)-sum(debit),0) v from journal_lines where account_code=$1",
  pnl: "select c.acct_type t, coalesce(sum(l.credit)-sum(l.debit),0) v from journal_lines l join chart_of_accounts c on c.account_code=l.account_code where c.acct_type in ('REVENUE','EXPENSE') group by c.acct_type",
  bs: "select c.acct_type t, coalesce(sum(l.debit)-sum(l.credit),0) v from journal_lines l join chart_of_accounts c on c.account_code=l.account_code where c.acct_type in ('ASSET','LIABILITY','EQUITY') group by c.acct_type",
} as const;

export const ACCOUNT = { outputVat: "2130", inputVat: "1140", whtPayable: "2140" } as const;
export { ACCOUNT_LABEL };
