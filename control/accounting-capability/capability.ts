/**
 * หน้าที่: ACCOUNTING_CAPABILITY — ทางเข้าเดียวของงานบัญชีทั้งระบบ
 *
 * Owner, 2026-09-05 Phase 5/6:
 * - adapter บาง ไม่มีกฎบัญชีอยู่ข้างใน (ไม่คำนวณ debit/credit, VAT, outstanding เอง)
 * - ทุก write ต้องผ่าน write boundary ที่ DNA OS ใช้อยู่ ห้ามเขียนฐานข้อมูลตรง
 * - unsupported event ต้อง fail closed
 *
 * ลำดับที่บังคับ: validate -> write intent -> idempotency -> adapter -> kernel
 *                 -> deterministic verification -> evidence -> normalized result
 *
 * Dependency ที่อนุญาต: ./types.ts ./calculation.ts ./kernel-gateway.ts
 *   ../../contracts/write-intent/write-intent.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้าม adapter ตัดสินตัวเลขบัญชีเอง หน้าที่มีแค่ map + attach evidence + เรียก kernel
 * - ห้ามคืน POSTING_RESULT ถ้า Σdebit ≠ Σcredit
 */

import type { WriteIntent } from "../../contracts/write-intent/write-intent";
import { amountsAreConsistent } from "./calculation";
import * as K from "./kernel-gateway";
import type {
  AccountingInput, AccountingOutput, DocumentAmounts, ErrorResultOut,
  EvidencePointer, PaymentAllocationRequest, PostingResultOut, SourceType,
} from "./types";

export const ACCOUNTING_CAPABILITY_ID = "capability-accounting-boundary-v1";

const fail = (reason_code: string, reason: string): ErrorResultOut =>
  ({ kind: "ERROR_RESULT", reason_code, reason });

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/** uuid v5-ish ที่คงที่: แหล่งเดียวกัน id เดียวกัน ต้องได้ uuid เดิมเสมอ */
async function stableUuid(namespace: string, value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const h = createHash("sha256").update(`${namespace}:${value}`).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), "5" + h.slice(13, 16), "8" + h.slice(17, 20), h.slice(20, 32)].join("-");
}

// ─── Phase 6: write boundary ────────────────────────────────────────────────

export interface CapabilityCaller {
  readonly identity_id: string;
  readonly kind: "ai_agent" | "external_program";
  readonly display_name: string;
}

/**
 * สร้าง WriteIntent ตามสัญญาที่ DNA OS ใช้อยู่ ไม่ตัดสิน ALLOW/DENY เอง
 * ผู้ตัดสินคือ permissions/write-gate/ ตามที่ control/ai-write-control/ ล็อกไว้
 */
export function buildWriteIntent(input: AccountingInput, caller: CapabilityCaller): WriteIntent | null {
  if (input.kind === "ACCOUNTING_QUERY") return null; // อ่านอย่างเดียว ไม่ต้องมี intent
  return {
    intent_id: `wi-acct-${input.idempotency_key}`,
    operation: "CREATE",
    capability: ACCOUNTING_CAPABILITY_ID,
    target_type: "CAPABILITY",
    target_path: "control/accounting-capability",
    requested_change: `บันทึกบัญชีจาก ${input.kind} (${input.source_type}/${input.source_id})`,
    requesting_agent: caller,
    evidence: input.evidence.map((e) => ({
      source: `${e.source_type}/${e.source_id}`,
      note: e.original_pointer ?? "มีเฉพาะแถวในระบบเดิม ไม่มีไฟล์ต้นฉบับ",
    })),
    correlation_id: input.idempotency_key,
    submitted_at: new Date().toISOString(),
  };
}

// ─── ตรวจสัญญาขาเข้า ────────────────────────────────────────────────────────

function validate(input: AccountingInput): ErrorResultOut | null {
  if (input.kind === "ACCOUNTING_QUERY") return null;
  for (const f of ["source_type", "source_id", "company_id", "occurred_at", "idempotency_key"] as const) {
    if (typeof input[f] !== "string" || input[f] === "") {
      return fail("MISSING_REQUIRED_FIELD", `input ขาด ${f}`);
    }
  }
  if (input.evidence.length === 0) return fail("MISSING_EVIDENCE", "ทุก posting ต้องมี evidence อย่างน้อยหนึ่งรายการ");
  if ("payload" in input && "amounts" in (input.payload as Record<string, unknown>)) {
    const a = (input.payload as { amounts: DocumentAmounts }).amounts;
    if (!amountsAreConsistent(a)) {
      return fail("AMOUNTS_INCONSISTENT", "ยอดในเอกสารประกอบกันเองไม่ได้ — calculation layer ต้องยืนยันก่อน");
    }
  }
  return null;
}

// ─── การรันจริง ─────────────────────────────────────────────────────────────

export interface ExecuteOptions {
  readonly connection: K.KernelConnection;
  readonly caller: CapabilityCaller;
  /** ผู้ตัดสินสิทธิ์ — capability ไม่ตัดสินเอง ถ้าไม่ส่งมาถือว่าปฏิเสธ */
  readonly authorize: (intent: WriteIntent) => Promise<boolean>;
}

export async function executeAccounting(
  input: AccountingInput,
  opts: ExecuteOptions,
): Promise<AccountingOutput> {
  const invalid = validate(input);
  if (invalid !== null) return invalid;

  const intent = buildWriteIntent(input, opts.caller);
  if (intent !== null) {
    const allowed = await opts.authorize(intent).catch(() => false);
    if (!allowed) return fail("WRITE_DENIED", "write boundary ปฏิเสธการเขียนนี้");
  }

  try {
    return await K.withKernel(opts.connection, async (q) => {
      if (input.kind === "ACCOUNTING_QUERY") return runQuery(q, input);
      return runPosting(q, input);
    });
  } catch (e) {
    return fail("KERNEL_REJECTED", e instanceof Error ? e.message : String(e));
  }
}

type Q = Parameters<Parameters<typeof K.withKernel>[1]>[0];

async function runPosting(q: Q, input: Exclude<AccountingInput, { kind: "ACCOUNTING_QUERY" }>): Promise<AccountingOutput> {
  // Phase 8-F: ซ้ำต้องคืนผลเดิม ไม่โพสต์ใหม่
  const existing = await K.findExistingEvent(q, input.idempotency_key);
  if (existing !== null) {
    const rows = await q("select id from journal_entries where event_id = $1::uuid and reversal_of is null limit 1", [existing]);
    if (rows.length > 0) {
      const entry = await K.readEntry(q, String(rows[0]!.id));
      return { kind: "POSTING_RESULT", posted: true, idempotent_replay: true, entry, evidence: await K.readEvidence(q, entry.entry_id) };
    }
  }

  // fail closed ก่อนแตะ kernel — ชนิดที่ไม่มีผลทางบัญชีต้องไม่สร้างงวดหรือบริษัททิ้งไว้
  if (input.kind === "BUSINESS_EVENT") {
    return fail("NO_ACCOUNTING_EFFECT",
      "business event เป็น source data ยังไม่มีผลทางบัญชีจนกว่าจะกลายเป็นเอกสารหรือการชำระเงิน");
  }
  if (input.kind === "ADJUSTMENT") {
    return fail("ADJUSTMENT_REQUIRES_DOCUMENT", "การปรับปรุงต้องมาพร้อมใบลดหนี้ ใช้ CREDIT_NOTE แทน");
  }

  const period = await K.resolvePeriod(q, input.occurred_at);
  await K.ensureCompany(q, input.company_id);

  switch (input.kind) {
    case "SALES_DOCUMENT": {
      const a = input.payload.amounts;
      const docId = await stableUuid("invoices", input.source_id);
      await K.upsertSalesDocument(q, docId, {
        document_no: input.payload.document_no, company_id: input.company_id,
        vat_amount: a.vat_amount, total_amount: a.total_amount,
      });
      const eventId = await K.createEvent(q, {
        event_type: input.payload.is_tax_invoice ? "issue_tax_invoice" : "issue_invoice",
        amount: a.total_amount, party_id: input.company_id,
        occurred_at: input.occurred_at, period_code: period, idempotency_key: input.idempotency_key,
      });
      await K.attachKernelDocumentEvidence(q, eventId, "invoice_id", docId);
      for (const ev of input.evidence) await K.attachSourceEvidence(q, eventId, ev);
      return finish(q, eventId, input.evidence);
    }

    case "PURCHASE_DOCUMENT": {
      const a = input.payload.amounts;
      const docId = await stableUuid("supplier_documents", input.source_id);
      await K.ensureCompany(q, input.payload.vendor_company_id);
      await K.upsertPurchaseDocument(q, docId, {
        document_no: input.payload.document_no, vendor_company_id: input.payload.vendor_company_id,
        net_amount: a.tax_base, vat_amount: a.vat_amount, total_amount: a.total_amount,
      });
      const eventId = await K.createEvent(q, {
        event_type: "expense", amount: a.total_amount, party_id: input.payload.vendor_company_id,
        occurred_at: input.occurred_at, period_code: period, idempotency_key: input.idempotency_key,
      });
      await K.attachKernelDocumentEvidence(q, eventId, "supplier_document_id", docId);
      for (const ev of input.evidence) await K.attachSourceEvidence(q, eventId, ev);
      return finish(q, eventId, input.evidence);
    }

    case "PAYMENT":
    case "BANK_TRANSACTION": {
      const p = input.payload;
      if (p.allocations.length === 0) return fail("MISSING_ALLOCATION", "การชำระเงินต้องระบุว่าไปตัดเอกสารใด");
      const eventId = await K.createEvent(q, {
        event_type: p.direction === "MONEY_IN" ? "receive_payment" : "pay",
        amount: p.amount, party_id: input.company_id,
        occurred_at: input.occurred_at, period_code: period, idempotency_key: input.idempotency_key,
      });
      for (const al of p.allocations) {
        await K.addAllocation(q, eventId, {
          side: al.side === "RECEIVABLE" ? "AR" : "AP",
          doc_kind: al.side === "RECEIVABLE" ? "invoice" : "supplier",
          document_id: await stableUuid(al.side === "RECEIVABLE" ? "invoices" : "supplier_documents", al.document_source_id),
          amount: al.amount,
        });
      }
      for (const ev of input.evidence) await K.attachSourceEvidence(q, eventId, ev);
      return finish(q, eventId, input.evidence);
    }

    case "CREDIT_NOTE": {
      const a = input.payload.amounts;
      const cnId = await stableUuid("credit_notes", input.source_id);
      await K.upsertCreditNote(q, cnId, {
        cn_no: input.payload.credit_note_no,
        invoice_id: await stableUuid("invoices", input.payload.against_source_id),
        net_amount: a.tax_base, vat_amount: a.vat_amount, total_amount: a.total_amount,
      });
      const eventId = await K.createEvent(q, {
        event_type: "adjustment", amount: a.total_amount, party_id: input.company_id,
        occurred_at: input.occurred_at, period_code: period, idempotency_key: input.idempotency_key,
      });
      await K.attachKernelDocumentEvidence(q, eventId, "credit_note_id", cnId);
      for (const ev of input.evidence) await K.attachSourceEvidence(q, eventId, ev);
      return finish(q, eventId, input.evidence);
    }

    default: {
      const never: never = input;
      return fail("UNSUPPORTED_INPUT", `ไม่รองรับ input ชนิดนี้: ${JSON.stringify(never)}`);
    }
  }
}

/** โพสต์ แล้วตรวจสมดุลก่อนคืนผล — ไม่สมดุลห้ามคืนว่าสำเร็จ */
async function finish(q: Q, eventId: string, evidence: readonly EvidencePointer[]): Promise<AccountingOutput> {
  const entryId = await K.postEvent(q, eventId);
  const entry = await K.readEntry(q, entryId);
  if (!entry.balanced) return fail("UNBALANCED_ENTRY", "รายการที่โพสต์ไม่สมดุล — ปฏิเสธผลลัพธ์");
  const result: PostingResultOut = {
    kind: "POSTING_RESULT", posted: true, idempotent_replay: false,
    entry, evidence: await K.readEvidence(q, entryId),
  };
  return result;
}

// ─── ฝั่งอ่าน: ทุกตัวเลข derive จาก journal เดียวกัน ────────────────────────

async function runQuery(q: Q, input: Extract<AccountingInput, { kind: "ACCOUNTING_QUERY" }>): Promise<AccountingOutput> {
  const num = (rows: Record<string, unknown>[], key: string) => Number(rows[0]?.[key] ?? 0);

  switch (input.query) {
    case "AR_STATUS": {
      const rows = await q(K.REPORT_SQL.arByDocument);
      const lines = rows.map((r) => ({ source_type: null, source_id: String(r.document_id), document_no: null, amount: round2(Number(r.bal)) }));
      return { kind: "AR_STATUS", lines, total: round2(lines.reduce((a, l) => a + l.amount, 0)) };
    }
    case "AP_STATUS": {
      const rows = await q(K.REPORT_SQL.apByDocument);
      const lines = rows.map((r) => ({ source_type: null, source_id: String(r.document_id), document_no: null, amount: round2(Number(r.bal)) }));
      return { kind: "AP_STATUS", lines, total: round2(lines.reduce((a, l) => a + l.amount, 0)) };
    }
    case "OUTSTANDING": {
      const ar = await q(K.REPORT_SQL.arByDocument);
      const ap = await q(K.REPORT_SQL.apByDocument);
      return {
        kind: "OUTSTANDING",
        receivable: round2(ar.reduce((a, r) => a + Number(r.bal), 0)),
        payable: round2(ap.reduce((a, r) => a + Number(r.bal), 0)),
      };
    }
    case "VAT_RESULT": {
      const out = num(await q(K.REPORT_SQL.vat, [K.ACCOUNT.outputVat]), "v");
      const inp = -num(await q(K.REPORT_SQL.vat, [K.ACCOUNT.inputVat]), "v");
      return { kind: "VAT_RESULT", period_code: input.period_code ?? "ALL", output_vat: round2(out), input_vat: round2(inp), net_vat: round2(out - inp) };
    }
    case "WHT_RESULT": {
      const pay = num(await q(K.REPORT_SQL.vat, [K.ACCOUNT.whtPayable]), "v");
      const recv = -num(await q(K.REPORT_SQL.vat, ["1150"]), "v");
      return { kind: "WHT_RESULT", period_code: input.period_code ?? "ALL", receivable: round2(recv), payable: round2(pay) };
    }
    case "TRIAL_BALANCE": {
      const rows = await q(K.REPORT_SQL.trialBalance);
      const mapped = rows.map((r) => ({ account: K.ACCOUNT_LABEL[String(r.account_code)] ?? String(r.account_code), debit: round2(Number(r.d)), credit: round2(Number(r.c)) }));
      const td = round2(mapped.reduce((a, r) => a + r.debit, 0));
      const tc = round2(mapped.reduce((a, r) => a + r.credit, 0));
      return { kind: "TRIAL_BALANCE", rows: mapped, total_debit: td, total_credit: tc, balanced: Math.abs(td - tc) < 0.01 };
    }
    case "PNL": {
      const rows = await q(K.REPORT_SQL.pnl);
      const get = (t: string) => Number(rows.find((r) => r.t === t)?.v ?? 0);
      const revenue = round2(get("REVENUE"));
      const expense = round2(-get("EXPENSE"));
      return { kind: "PNL", revenue, expense, profit: round2(revenue - expense) };
    }
    case "BALANCE_SHEET": {
      const rows = await q(K.REPORT_SQL.bs);
      const get = (t: string) => Number(rows.find((r) => r.t === t)?.v ?? 0);
      const assets = round2(get("ASSET"));
      const liabilities = round2(-get("LIABILITY"));
      const pnl = await q(K.REPORT_SQL.pnl);
      const g = (t: string) => Number(pnl.find((r) => r.t === t)?.v ?? 0);
      const equity = round2(-get("EQUITY") + g("REVENUE") + g("EXPENSE"));
      return { kind: "BALANCE_SHEET", assets, liabilities, equity, balanced: Math.abs(assets - liabilities - equity) < 0.01 };
    }
    case "TAX_PACKAGE": {
      const out = num(await q(K.REPORT_SQL.vat, [K.ACCOUNT.outputVat]), "v");
      const inp = -num(await q(K.REPORT_SQL.vat, [K.ACCOUNT.inputVat]), "v");
      return {
        kind: "TAX_PACKAGE", period_code: input.period_code ?? "ALL",
        output_vat: round2(out), input_vat: round2(inp), net_vat: round2(out - inp),
        built_from_ledger: true, submitted: false,
      };
    }
    case "ACCOUNTING_EVIDENCE": {
      if (input.source_id === undefined) return fail("MISSING_SOURCE_ID", "ต้องระบุ source_id ที่จะสืบกลับ");
      const rows = await q(
        `select j.id from journal_entries j
           join financial_event_evidence e on e.event_id = j.event_id
          where e.source_ref = $1 limit 1`, [input.source_id]);
      if (rows.length === 0) return fail("NO_EVIDENCE_FOUND", "ไม่พบรายการบัญชีที่อ้างถึงแหล่งนี้");
      const entryId = String(rows[0]!.id);
      return { kind: "ACCOUNTING_EVIDENCE", entry_id: entryId, traces_to: await K.readEvidence(q, entryId) };
    }
    case "JOURNAL_ENTRY": {
      if (input.source_id === undefined) return fail("MISSING_SOURCE_ID", "ต้องระบุ entry_id");
      return { ...(await K.readEntry(q, input.source_id)), kind: "JOURNAL_ENTRY" };
    }
    default:
      return fail("UNSUPPORTED_QUERY", `ไม่รองรับคำถามนี้: ${String(input.query)}`);
  }
}

export type { AccountingInput, AccountingOutput, SourceType, PaymentAllocationRequest };
