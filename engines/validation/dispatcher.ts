/**
 * Command Dispatcher — ผู้บังคับใช้กฎรัฐธรรมนูญ DNA OS
 *
 * ทุก command ต้องผ่านที่นี่:
 * 1. ตรวจว่า command อยู่ใน registry ไหม (ไม่มี = reject)
 * 2. ตรวจ input ตาม schema ที่ประกาศ
 * 3. ใส่ constraints อัตโนมัติ (document_type, status filter)
 * 4. ตรวจ requires_confirmation
 */

import {
  getOpenDebts, getAllDebts, getDebtTrackings, getDocuments,
  getLatestInvoice, getReceipts, getJobs, getPartners, getCustomerGps, getPartnerById,
  getMaterialTypes, getPendingDrafts,
  getPartnersWithDocumentSummary, getDocumentsByPartner, getBusinessEventsByPartner,
} from "@/services/supabase/queries";
import { buildPartnerTimeline, buildPartnerSummary } from "@/engines/partner/timeline";
import { getCurrentDebt, type CurrentDebt } from "@/engines/debt/tracking";
import { resolveMaterial } from "@/engines/material-resolver";
import { tryQuoteMaterialPrice } from "@/engines/quote-price";
import { supabaseAdmin } from "@/services/supabase/queries";
import { calcCapacity } from "@/engines/capacity";
import { calcCost } from "@/engines/cost";
import { loadCompanySettings } from "@/core/config/company-settings";
import registry from "@/registry/command-registry.json";
import { classify, type Classification } from "@/engines/governance/hardcode-decision-engine";
import { isTenantScopedRead, scopeCanReadTenantData, NO_DATA_SCOPE, type DataScope } from "@/core/authority/data-scope";
import { currentDataScope } from "@/core/authority/data-scope-context";
import { emitExecutionEvent } from "@/core/runtime/trace";

// ── Types ──

export interface DispatchResult {
  ok: boolean;
  command: string;
  data: unknown;
  requires_confirmation: boolean;
  violations: string[];
  hardcode_warnings?: Classification[];
}

interface CommandDef {
  owner: string;
  layer: string;
  input: Record<string, string>;
  output: string;
  description: string;
  requires_confirmation: boolean;
}

// ── Query Constraints ──
// command → ฟังก์ชันดึงข้อมูลที่ใส่ filter ถูกต้องตามกฎ

/** Every tenant read receives the request's verified scope; none may widen it. */
type QueryFn = (payload: Record<string, unknown>, scope: DataScope) => Promise<unknown>;

const QUERY_MAP: Record<string, QueryFn> = {
  // GetCurrentDebt(partnerId) — the one business capability for a single
  // customer's debt (owner, 2026-07-17, Architecture Correction). AI must
  // call this by name; it must never know getCurrentDebt()/
  // calcDebtTrackingSummary()/calcDebtFull() exist underneath.
  "debt.current":     async (p, scope) => {
    const partnerId = String(p.partner_id ?? "");
    if (!partnerId) throw new Error("ต้องระบุ partner_id");
    // Scope is proven BEFORE the debt reader runs — an out-of-scope partner
    // never reaches the financial snapshot at all.
    await getPartnerById(partnerId, scope);
    return getCurrentDebt(partnerId);
  },
  "debt.list":        async (_p, scope) => getOpenDebts(scope),
  "debt.all":         async (_p, scope) => getAllDebts(scope),
  "debt.trackings":   async (_p, scope) => getDebtTrackings(scope),
  "invoice.list":     async (_p, scope) => getDocuments("invoice", scope),
  "invoice.latest":   async (_p, scope) => getLatestInvoice(scope),
  "document.list":    async (_p, scope) => getDocuments(undefined, scope),
  "document.boq":     async (_p, scope) => getDocuments("boq", scope),
  "document.po":      async (_p, scope) => getDocuments("purchase_order", scope),
  "document.do":      async (_p, scope) => getDocuments("delivery_order", scope),
  "document.receipt":  async (_p, scope) => getReceipts(scope),
  "draft.list":       async () => getPendingDrafts(),
  "job.list":         async (_p, scope) => getJobs(undefined, scope),
  "job.active":       async (_p, scope) => getJobs("IN_PROGRESS", scope),
  "partner.list":     async (_p, scope) => getPartnersWithDocumentSummary(scope),
  // FindPartner(keyword) — was inlined in cognitive/executor's
  // resolveIdentity() as a raw getPartners() + client-side filter (owner,
  // 2026-07-17, Architecture Correction: no direct service calls from AI
  // code). "partner.find" was already declared in command-registry.json
  // with no handler — this fills that gap rather than creating a new name.
  "partner.find":     async (p, scope) => {
    const keyword = String(p.keyword ?? "").trim().toLowerCase();
    if (!keyword) return [];
    // DNA-000228: normalize ช่องว่างตอนเทียบ (production bug พิสูจน์แล้ว:
    // "ช. ธวัชชัยการช่าง" คืน 0 รายทั้งที่ "ช.ธวัชชัยการช่าง" มีอยู่จริง) — และ
    // WAVE 2: อ่านภายใต้ DataScope ของผู้เรียก (ไม่มีหลักฐานองค์กร = ไม่เห็นข้อมูล)
    const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, "");
    const kw = norm(keyword);
    const partners = await getPartners(scope);
    return partners.filter((x) => norm(x.name).includes(kw));
  },
  // GenerateMaterialQuote(raw_input, quantity, customer_id) — was inlined in
  // cognitive/executor's buildMaterialItems() calling getMaterialTypes(),
  // resolveMaterial(), getCustomerGps(), tryQuoteMaterialPrice() directly
  // (owner, 2026-07-17, Architecture Correction). DNA OS coordinates
  // Material Resolver + Customer GPS + Pricing Engine internally and
  // returns one business response; AI never sees those three engines.
  "material.quote":   async (p, scope) => {
    const rawInput = String(p.raw_input ?? "");
    const quantity = Number(p.quantity ?? 0);
    const customerId = String(p.customer_id ?? "");
    if (!rawInput || !quantity) throw new Error("ต้องระบุ raw_input และ quantity");

    const materialTypes = await getMaterialTypes();
    const match = resolveMaterial(rawInput, materialTypes);
    if (!match.matched) {
      return { matched: false, candidates: match.candidates.map((c) => c.name) };
    }

    if (!customerId) return { matched: true, material_name: match.matched.name, error: "no_customer_id" };
    const gps = await getCustomerGps(customerId, scope);
    if (!gps) return { matched: true, material_name: match.matched.name, error: "no_gps" };

    const quote = await tryQuoteMaterialPrice(match.matched.name, quantity, gps);
    if (!quote.ok || quote.unitPrice == null) {
      return { matched: true, material_name: match.matched.name, error: quote.text };
    }

    // Real transport cost (owner, 2026-07-24) — document generation (unlike
    // the chat quick-reply text, which deliberately says "ยังไม่รวมค่าขนส่ง")
    // needs a real total. Reuses the SAME matched pit/distance quote already
    // found above (never re-derives a possibly-different nearest pit), plus
    // the existing vehicle-capacity/fuel engines (engines/capacity.ts,
    // engines/cost.ts) — real GPS distance x real pump fuel price, no
    // driver-wage constant (owner correction 2026-07-25: the truck owner is
    // an independent contractor, not a cost DNA OS pays separately).
    let transportCost = 0;
    let trips: number | undefined;
    if (quote.pitProfileId != null && quote.distanceKm != null) {
      const capacity = await calcCapacity({ quantity });
      const cost = await calcCost({
        distance_km: quote.distanceKm,
        quantity,
        trips: capacity.trips_required,
        material_type_id: match.matched.id,
        pit_profile_id: quote.pitProfileId,
      });
      transportCost = cost.fuel_cost;
      trips = capacity.trips_required;
    }

    return {
      matched: true,
      material_name: quote.materialName ?? match.matched.name,
      quantity,
      unit: quote.quantityUnit ?? "คิว",
      unit_price: quote.unitPrice,
      distance_km: quote.distanceKm,
      trips,
      transport_cost: transportCost,
      total_price: quote.unitPrice * quantity + transportCost,
    };
  },
  "partner.timeline": async (p, scope) => {
    const partnerId = String(p.partner_id ?? "");
    if (!partnerId) throw new Error("ต้องระบุ partner_id");
    const [docs, events] = await Promise.all([
      getDocumentsByPartner(partnerId, scope),
      getBusinessEventsByPartner(partnerId, scope),
    ]);
    const summary = buildPartnerSummary(
      { id: partnerId, name: "", partner_type_label: null, phone: null },
      docs,
    );
    const timeline = buildPartnerTimeline(docs, events);
    return { summary, timeline };
  },
  "material.list":    async () => getMaterialTypes(),
  // ── DNA-000222 BUSINESS DATA SOURCE COVERAGE ─────────────────────────────
  // เติมคำสั่งอ่านที่ "ตารางมีจริงใน production แต่ยังไม่มีบน dispatcher" —
  // ใช้ select เดียวกับที่ admin routes อ่านอยู่แล้ว (payment_allocations join
  //  invoices/companies แบบ app/api/admin/finance/transactions, company_expenses
  //  แบบ app/api/admin/company-expenses, bank_statement_transactions แบบที่
  //  pipeline bank ใช้) — read-only ล้วน ไม่มีการคำนวณเงินใหม่
  "invoice.payments": async (p) => {
    const documentId = String(p.document_id ?? "");
    let q = supabaseAdmin()
      .from("payment_allocations")
      .select("id, amount, allocated_at, receipt_document_id, invoices:invoice_id(invoice_no, customer_company_id, companies:customer_company_id(name))")
      .order("allocated_at", { ascending: false });
    if (documentId) q = q.eq("invoice_id", documentId);
    const { data, error } = await q.limit(100);
    if (error) throw new Error(error.message);
    return { allocations: data ?? [] };
  },
  "expense.list":     async () => {
    const { data, error } = await supabaseAdmin()
      .from("company_expenses")
      .select("id, expense_date, document_type, vendor_name, tax_invoice_no, amount, quantity, submitted_by_name, created_at")
      .order("expense_date", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { expenses: data ?? [] };
  },
  // ── DNA-000226 RECEIPT EVIDENCE READ PATH ──────────────────────────────────
  // อ่าน receipt_documents (495 แถวรอบ production) ผ่าน dispatcher — รูป query
  // ชุดเดียวกับ GET app/api/admin/receipt-documents (reader เดิม) แต่เปิด
  // ทุกสถานะ + กรองตาม verification + pagination/total ชัดเจน · document.receipt
  // (invoices PAID) ไม่ถูกแตะ — แยกคนละ source ตามเดิม
  "receipt.list":     async (p) => {
    const limit = Math.min(Number(p.limit ?? 50), 100);
    const offset = Math.max(Number(p.offset ?? 0), 0);
    const verification = String(p.verification ?? "all");
    let q = supabaseAdmin()
      .from("receipt_documents")
      .select("id, document_type, vendor_name, sender_name, amount, document_date, transaction_datetime, status, payment_verified, verification_level, source_channel, reference_number, customer_company_id, companies:customer_company_id(name)", { count: "exact" });
    if (verification === "verified") q = q.eq("payment_verified", true);
    if (verification === "unverified") q = q.eq("payment_verified", false);
    const { data, error, count } = await q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return { receipts: (data ?? []).map((r) => ({ ...r, partner_name: r.companies?.[0]?.name ?? null, companies: undefined })), total: count ?? (data ?? []).length, limit, offset };
  },
  "receipt.latest":    async (p) => {
    const { data, error } = await supabaseAdmin()
      .from("receipt_documents")
      .select("id, document_type, vendor_name, sender_name, amount, document_date, transaction_datetime, status, payment_verified, verification_level, source_channel, reference_number, customer_company_id, companies:customer_company_id(name)")
      .order("created_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    const r = (data ?? [])[0] ?? null;
    return { receipt: r ? { ...r, partner_name: r.companies?.[0]?.name ?? null, companies: undefined } : null };
  },
  "receipt.get":       async (p) => {
    const id = String(p.receipt_id ?? "");
    if (!id) throw new Error("ต้องระบุ receipt_id");
    const { data, error } = await supabaseAdmin()
      .from("receipt_documents")
      .select("id, document_type, vendor_name, sender_name, amount, document_date, transaction_datetime, status, payment_verified, verification_level, source_channel, reference_number, customer_company_id, media_mime_type, media_size_bytes, companies:customer_company_id(name)")
      .eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("ไม่พบรหัสหลักฐานนี้");
    return { receipt: { ...data, partner_name: data.companies?.[0]?.name ?? null, companies: undefined } };
  },
  "bank.statement":   async () => {
    const { data, error } = await supabaseAdmin()
      .from("bank_statement_transactions")
      .select("*")
      .order("transaction_date", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { transactions: data ?? [] };
  },
  // PartnerProfile(partnerId) — owner, 2026-07-17, Invoice Preview
  // Redesign. Wraps the existing getPartnerById() (services/supabase/
  // queries.ts:564), which had zero AI-facing callers before this.
  "partner.profile":  async (p, scope) => {
    const partnerId = String(p.partner_id ?? "");
    if (!partnerId) throw new Error("ต้องระบุ partner_id");
    return getPartnerById(partnerId, scope);
  },
  // InvoiceItems(partnerId) — owner, 2026-07-17, Invoice Preview Redesign.
  // Scoped to debt-priced documents (invoice/billing/receipt) — material-
  // priced documents (quotation/boq/delivery_order) go through the
  // separate "material.quote" capability, unchanged. Takes the debt object
  // the ORCHESTRATOR already fetched via GetCurrentDebt in the SAME
  // request — never re-derives it from a different source, and never reads
  // planner results[]. debt === null is a real business state (no
  // outstanding debt), not an error — returned as-is so the caller can
  // decide what to do, never silently priced at ฿0.00.
  "invoice.items":    async (p) => {
    const debt = p.debt as CurrentDebt | null;
    if (!debt) return { status: "NO_OUTSTANDING_DEBT" as const, items: [] };

    const items: { description: string; qty: number; unit: string; unitPrice: number }[] = [
      { description: "เงินต้นยกมา", qty: 1, unit: "รายการ", unitPrice: debt.principal },
    ];
    if (debt.interest > 0) items.push({ description: `ดอกเบี้ย (${debt.overdue_days} วัน)`, qty: 1, unit: "รายการ", unitPrice: debt.interest });
    if (debt.penalty > 0) items.push({ description: `ค่าปรับล่าช้าชำระ (${debt.overdue_days} วัน)`, qty: 1, unit: "รายการ", unitPrice: debt.penalty });
    if (debt.collection_fee > 0) items.push({ description: "ค่าธรรมเนียมติดตามหนี้", qty: 1, unit: "รายการ", unitPrice: debt.collection_fee });

    return { status: "OK" as const, items };
  },
  // CalculateTax(amount) — owner, 2026-07-17, Invoice Preview Redesign.
  // Was a registered command with zero handler (confirmed empty in the
  // prior audit) — filled in against the schema command-registry.json
  // already declared (amount/vat_rate?/withholding_rate?), not a new
  // contract. vat_rate defaults to the real DB-driven company setting
  // (core/config/company-settings.ts's "vat-rate" key) when not supplied —
  // never hardcoded. withholding_rate only applied if the caller supplies
  // it explicitly; no default is invented for it since no config source
  // for it exists yet.
  "business.calculate_tax": async (p) => {
    const amount = Number(p.amount ?? 0);
    const branding = await loadCompanySettings();
    const vatRate = p.vat_rate != null ? Number(p.vat_rate) : branding.vatRate;
    const vat = Math.round(amount * vatRate * 100) / 100;
    const withholdingRate = p.withholding_rate != null ? Number(p.withholding_rate) : null;
    const withholding = withholdingRate != null ? Math.round(amount * withholdingRate * 100) / 100 : 0;
    return {
      subtotal: amount,
      vat_rate: vatRate,
      vat,
      withholding_rate: withholdingRate,
      withholding,
      total: amount + vat - withholding,
    };
  },
  // "invoice.preview" moved OUT of this file (owner, 2026-07-18) —
  // Architecture Drift fix. It needed GenerateDocument (gateway/actions.ts's
  // previewDocumentCreate), and engines/ is not allowed to import gateway/
  // (registry/dependency-graph.json — the intended direction is gateway ->
  // engines, never the reverse). Orchestration now lives in
  // cognitive/executor/index.ts's generateInvoicePreview(), which already
  // legitimately imports both engines (via dispatchCommand, calling
  // partner.profile/debt.current/invoice.items/business.calculate_tax below)
  // and gateway directly — same pattern cognitive already used elsewhere.
  // No behavior changed, only which file owns the orchestration.
};

// ── Dispatcher ──

const commands = registry.commands as Record<string, CommandDef>;

export function isRegistered(command: string): boolean {
  return command in commands;
}

export function getCommandDef(command: string): CommandDef | null {
  return commands[command] ?? null;
}

export function listCommands(): string[] {
  return Object.keys(commands);
}

/**
 * HCG-P2 — Command Execution Layer wiring, REPORT_ONLY (registry/hardcode-governance/
 * enforcement-config.json -> integration_points.command_execution_layer). Classifies
 * string/number payload values before dispatch executes; never blocks — findings are
 * returned on DispatchResult.hardcode_warnings and logged, not enforced, at this phase.
 */
function scanPayloadForHardcodes(command: string, payload: Record<string, unknown>): Classification[] {
  const findings: Classification[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const c = classify({ value: String(value), context_key: key, file: `dispatcher:${command}`, line: 0 });
    if (c.verdict !== "ALLOWED" && c.category !== "UNKNOWN") {
      findings.push(c);
    }
  }
  if (findings.length > 0) {
    console.warn(
      `[hardcode-governance][REPORT_ONLY] command "${command}" payload has ${findings.length} flagged value(s):`,
      findings.map((f) => `${f.value} (${f.category}/${f.verdict})`).join("; ")
    );
  }
  return findings;
}

export function validateInput(command: string, payload: Record<string, unknown>): string[] {
  const def = commands[command];
  if (!def) return [`command "${command}" ไม่อยู่ใน registry — ปฏิเสธ`];

  const violations: string[] = [];
  for (const [field, type] of Object.entries(def.input)) {
    if (field.endsWith("?")) continue;
    if (!(field in payload)) {
      violations.push(`ขาด input "${field}" (ต้องเป็น ${type})`);
    }
  }
  return violations;
}

export async function dispatch(
  command: string,
  payload: Record<string, unknown> = {},
  confirmed = false,
  accessScope?: DataScope,
): Promise<DispatchResult> {
  const def = commands[command];

  if (!def) {
    return {
      ok: false,
      command,
      data: null,
      requires_confirmation: false,
      violations: [`command "${command}" ไม่อยู่ใน registry — Shadow Command ถูกปฏิเสธ`],
    };
  }

  // STEP 1 (2026-10-25): a tenant read without a verified scope is DENIED,
  // never "unfiltered". The scope comes from the request boundary (session or
  // API token), never from the command payload.
  const scope = accessScope ?? currentDataScope();
  if (isTenantScopedRead(command) && !scopeCanReadTenantData(scope)) {
    emitExecutionEvent({
      event: "tool.selected",
      toolId: command,
      sourceReference: `registry/command-registry.json#${command}`,
      status: "denied",
    });
    return {
      ok: false,
      command,
      data: null,
      requires_confirmation: false,
      violations: [
        `DATA_SCOPE_REQUIRED: "${command}" อ่านข้อมูลธุรกิจได้เฉพาะเมื่อมีสมาชิกองค์กรที่ยืนยันแล้ว — ตรวจ ${scope?.reason ?? "NO_VERIFIED_ACTOR"}`,
      ],
    };
  }

  const sourceReference = `registry/command-registry.json#${command}`;
  emitExecutionEvent({ event: "tool.selected", toolId: command, sourceReference, status: "selected" });
  const violations = validateInput(command, payload);

  if (def.requires_confirmation && !confirmed) {
    return {
      ok: false,
      command,
      data: null,
      requires_confirmation: true,
      violations: violations.length > 0
        ? violations
        : [`command "${command}" ต้องได้รับการยืนยันจากมนุษย์ก่อน (Rule 72)`],
    };
  }

  if (violations.length > 0) {
    return { ok: false, command, data: null, requires_confirmation: def.requires_confirmation, violations };
  }

  const hardcode_warnings = scanPayloadForHardcodes(command, payload);

  const queryFn = QUERY_MAP[command];
  if (queryFn) {
    const startedAt = Date.now();
    emitExecutionEvent({ event: "reader.started", toolId: command, sourceReference, status: "started" });
    try {
      const data = await queryFn(payload, scope ?? NO_DATA_SCOPE);
      emitExecutionEvent({
        event: "reader.completed",
        toolId: command,
        sourceReference,
        status: "completed",
        durationMs: Date.now() - startedAt,
        recordCount: Array.isArray(data) ? data.length : undefined,
      });
      return { ok: true, command, data, requires_confirmation: false, violations: [], hardcode_warnings };
    } catch (err) {
      emitExecutionEvent({
        event: "reader.completed",
        toolId: command,
        sourceReference,
        status: "failed",
        durationMs: Date.now() - startedAt,
      });
      return {
        ok: false, command, data: null, requires_confirmation: false,
        violations: [`query error: ${err instanceof Error ? err.message : String(err)}`],
        hardcode_warnings,
      };
    }
  }

  return {
    ok: true,
    command,
    data: { message: `command "${command}" registered แต่ยังไม่มี query handler — ต้องพัฒนาเพิ่ม` },
    requires_confirmation: def.requires_confirmation,
    violations: [],
    hardcode_warnings,
  };
}
