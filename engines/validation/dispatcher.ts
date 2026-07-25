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
import { calcCapacity } from "@/engines/capacity";
import { calcCost } from "@/engines/cost";
import { loadCompanySettings } from "@/core/config/company-settings";
import registry from "@/registry/command-registry.json";

// ── Types ──

export interface DispatchResult {
  ok: boolean;
  command: string;
  data: unknown;
  requires_confirmation: boolean;
  violations: string[];
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

type QueryFn = (payload: Record<string, unknown>) => Promise<unknown>;

const QUERY_MAP: Record<string, QueryFn> = {
  // GetCurrentDebt(partnerId) — the one business capability for a single
  // customer's debt (owner, 2026-07-17, Architecture Correction). AI must
  // call this by name; it must never know getCurrentDebt()/
  // calcDebtTrackingSummary()/calcDebtFull() exist underneath.
  "debt.current":     async (p) => {
    const partnerId = String(p.partner_id ?? "");
    if (!partnerId) throw new Error("ต้องระบุ partner_id");
    return getCurrentDebt(partnerId);
  },
  "debt.list":        async () => getOpenDebts(),
  "debt.all":         async () => getAllDebts(),
  "debt.trackings":   async () => getDebtTrackings(),
  "invoice.list":     async () => getDocuments("invoice"),
  "invoice.latest":   async () => getLatestInvoice(),
  "document.list":    async () => getDocuments(),
  "document.boq":     async () => getDocuments("boq"),
  "document.po":      async () => getDocuments("purchase_order"),
  "document.do":      async () => getDocuments("delivery_order"),
  "document.receipt":  async () => getReceipts(),
  "draft.list":       async () => getPendingDrafts(),
  "job.list":         async () => getJobs(),
  "job.active":       async () => getJobs("IN_PROGRESS"),
  "partner.list":     async () => getPartnersWithDocumentSummary(),
  // FindPartner(keyword) — was inlined in cognitive/executor's
  // resolveIdentity() as a raw getPartners() + client-side filter (owner,
  // 2026-07-17, Architecture Correction: no direct service calls from AI
  // code). "partner.find" was already declared in command-registry.json
  // with no handler — this fills that gap rather than creating a new name.
  "partner.find":     async (p) => {
    const keyword = String(p.keyword ?? "").trim().toLowerCase();
    if (!keyword) return [];
    const partners = await getPartners();
    return partners.filter((x) => String(x.name ?? "").toLowerCase().includes(keyword));
  },
  // GenerateMaterialQuote(raw_input, quantity, customer_id) — was inlined in
  // cognitive/executor's buildMaterialItems() calling getMaterialTypes(),
  // resolveMaterial(), getCustomerGps(), tryQuoteMaterialPrice() directly
  // (owner, 2026-07-17, Architecture Correction). DNA OS coordinates
  // Material Resolver + Customer GPS + Pricing Engine internally and
  // returns one business response; AI never sees those three engines.
  "material.quote":   async (p) => {
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
    const gps = await getCustomerGps(customerId);
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
  "partner.timeline": async (p) => {
    const partnerId = String(p.partner_id ?? "");
    if (!partnerId) throw new Error("ต้องระบุ partner_id");
    const [docs, events] = await Promise.all([
      getDocumentsByPartner(partnerId),
      getBusinessEventsByPartner(partnerId),
    ]);
    const summary = buildPartnerSummary(
      { id: partnerId, name: "", partner_type_label: null, phone: null },
      docs,
    );
    const timeline = buildPartnerTimeline(docs, events);
    return { summary, timeline };
  },
  "material.list":    async () => getMaterialTypes(),
  // PartnerProfile(partnerId) — owner, 2026-07-17, Invoice Preview
  // Redesign. Wraps the existing getPartnerById() (services/supabase/
  // queries.ts:564), which had zero AI-facing callers before this.
  "partner.profile":  async (p) => {
    const partnerId = String(p.partner_id ?? "");
    if (!partnerId) throw new Error("ต้องระบุ partner_id");
    return getPartnerById(partnerId);
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

  const queryFn = QUERY_MAP[command];
  if (queryFn) {
    try {
      const data = await queryFn(payload);
      return { ok: true, command, data, requires_confirmation: false, violations: [] };
    } catch (err) {
      return {
        ok: false, command, data: null, requires_confirmation: false,
        violations: [`query error: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }

  return {
    ok: true,
    command,
    data: { message: `command "${command}" registered แต่ยังไม่มี query handler — ต้องพัฒนาเพิ่ม` },
    requires_confirmation: def.requires_confirmation,
    violations: [],
  };
}
