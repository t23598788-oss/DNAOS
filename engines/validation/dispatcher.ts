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
import { decideSandboxCommand } from "@/core/auth/surfacePolicy";
import { getCurrentDebt, type CurrentDebt } from "@/engines/debt/tracking";
import { resolveMaterial } from "@/engines/material-resolver";
import { tryQuoteMaterialPrice } from "@/engines/quote-price";
import { supabaseAdmin } from "@/services/supabase/queries";
import { getWeatherForecast, geocodeOpenMeteo } from "@/engines/weather";
import { calcFuel } from "@/engines/fuel";
import { getAllBangchakFuelPrices } from "@/engines/fuel-live";
import { calcDistance, findNearestPit } from "@/engines/distance";
import { calcTime } from "@/engines/time";
import { calcCapacity } from "@/engines/capacity";
import { calcCost } from "@/engines/cost";
import { loadCompanySettings } from "@/core/config/company-settings";
import registry from "@/registry/command-registry.json";
import { classify, type Classification } from "@/engines/governance/hardcode-decision-engine";

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
    // DNA-000232: filters อ่านอย่างเดียวเพิ่มจาก reader เดิม (type, in_address) —
    // ไม่สร้าง reader ใหม่
    const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, "");
    const kw = norm(keyword);
    const typeF = String(p.type ?? "").trim().toLowerCase();
    const addrF = norm(String(p.in_address ?? "").trim());
    if (!keyword && !typeF && !addrF) return [];
    const partners = await getPartners();
    return partners.filter((x) => {
      const nm = norm(x.name);
      const ad = norm((x as any).address);
      const okKw = keyword ? nm.includes(kw) : true;
      const okType = typeF ? norm((x as any).type).includes(typeF) : true;
      const okAddr = addrF ? ad.includes(addrF) : true;
      return okKw && okType && okAddr;
    });
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
  // DNA-000236: data-driven — filter จาก payload (ไม่ hardcode ชื่อวัสดุ) + sources/ราคาจาก pit_materials จริง
  "material.list": async (p) => {
    // DNA-000237: นับถูกต้อง — getMaterialTypes() ไม่ filter deleted_at (คืน 11 = รวม 3 soft-deleted) → query ตรง + เก็บเฉพาะที่ยังใช้งาน
    const baseQ = await supabaseAdmin().from("material_types").select("id, name, density_ton_per_cbm").is("deleted_at", null).order("name")
    if (baseQ.error) throw new Error("query error: " + baseQ.error.message)
    type Mat = { id: string; name: string; density_ton_per_cbm?: number }
    const base = (baseQ.data ?? []) as unknown as Mat[]
    const nameFilter = typeof p.name === "string" ? p.name.trim() : null
    const filtered = nameFilter ? base.filter((m: { name: string }) => m.name.includes(nameFilter)) : base
    const links = await supabaseAdmin().from("pit_materials").select("material_type_id, price, pit_profile_id").is("deleted_at", null)
    const pits = await supabaseAdmin().from("pit_profiles").select("id, pit_name").is("deleted_at", null)
    if (links.error) throw new Error("query error: " + links.error.message)
    if (pits.error) throw new Error("query error: " + pits.error.message)
    type Link = { material_type_id: string; price: number; pit_profile_id: string }
    const rows = (links.data ?? []) as unknown as Link[]
    const pitName = new Map((pits.data ?? []).map((x: { id: string; pit_name: string }) => [x.id, x.pit_name]))
    const materials = filtered.map((m: { id: string; name: string; density_ton_per_cbm?: number }) => {
      const src = rows.filter((l) => l.material_type_id === m.id)
      const prices = src.map((x) => Number(x.price)).filter((n) => n > 0)
      return { result_type: "MATERIAL", name: m.name, density_ton_per_cbm: m.density_ton_per_cbm ?? null, sources: src.map((x) => pitName.get(x.pit_profile_id)).filter(Boolean), price_min: prices.length ? Math.min(...prices) : null, price_max: prices.length ? Math.max(...prices) : null }
    })
    return { result_type: "MATERIAL_LIST", total: materials.length, filtered_by: nameFilter ?? null, materials }
  },
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
  // ── DNA-000232: expose engines ที่มีอยู่แล้วเป็นคำสั่งอ่าน (audit DNA-000231) ──
  "weather.forecast": async (p) => {
    // location name → coords ผ่าน Open-Meteo geocoding (provider เดิม) — ห้ามแต่ง coords
    let lat = Number(p.lat), lng = Number(p.lng), label = null;
    const place = String(p.location ?? "").trim();
    if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && place) {
      const g = await geocodeOpenMeteo(place);
      if (g) { lat = g.lat; lng = g.lng; label = g.label; }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("ต้องระบุ location (ชื่อสถานที่) หรือ lat/lng ที่ถูกต้อง");
    const dayOffset = Number(p.day_offset ?? 0);
    const f = await getWeatherForecast(lat, lng, dayOffset);
    if (!f) throw new Error("DATA_QUERY_FAILED: ไม่สามารถดึงพยากรณ์อากาศจากผู้ให้บริการได้ (ตรวจสอบพื้นที่/เวลาอีกครั้ง)");
    return { location: label ?? `${lat},${lng}`, lat, lng, day_offset: dayOffset, forecast: f };
  },
  "fuel.prices":     async () => {
    const r = await getAllBangchakFuelPrices();
    if (!r) throw new Error("DATA_QUERY_FAILED: ไม่สามารถดึงราคาเชื้อเพลิงสดจากผู้ให้บริการได้");
    return { source: "bangchak-oil-price-api", effective_date: r.effectiveDate, prices: r.prices };
  },
  "transport.estimate": async (p) => {
    const fromLat = Number(p.from_lat), fromLng = Number(p.from_lng), toLat = Number(p.to_lat), toLng = Number(p.to_lng);
    if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) throw new Error("ต้องระบุ from_lat, from_lng, to_lat, to_lng");
    const dist = await calcDistance({ from_lat: fromLat, from_lng: fromLng, to_lat: toLat, to_lng: toLng });
    const trips = Math.max(1, Number(p.trips ?? 1));
    const time = await calcTime({ distance_km: dist.distance_km, trips });
    const fuel = await calcFuel({ distance_km: dist.distance_km, trips });
    return { distance_km: dist.distance_km, distance_method: "straight-line (haversine) — ไม่ใช่ระยะทางถนนจริง", eta_note: "เวลาประมาณการจากอัตราเร็วเฉลี่ยใน config — ไม่ใช่ ETA จริง", duration: time, fuel, trips };
  },
  // DNA-000235: "ใครเคยซื้อทรายจากเรา" — ต้องมีหลักฐาน transaction จริง ห้ามเดา (VOID ไม่นับ)
  "purchase.history": async (p) => {
    const materialName = typeof p.material === "string" ? p.material.trim() : null
    const companyName = typeof p.company === "string" ? p.company.trim() : null
    const inv = await supabaseAdmin().from("invoices").select("id, invoice_no, invoice_status, invoice_date, total_amount, paid_amount, companies:customer_company_id(id, name), invoice_items(id, description, qty, unit, line_total)").neq("invoice_status", "VOID").order("invoice_date", { ascending: false }).limit(200)
    if (inv.error) throw new Error("query error: " + inv.error.message)
    type InvRow = { invoice_no: string; invoice_status: string; invoice_date: string; total_amount: number; companies: { id: string; name: string } | null; invoice_items: { description: string; qty: number; unit: string; line_total: number }[] }
    const rows = (inv.data ?? []) as unknown as InvRow[]
    const byCompany = companyName ? rows.filter((r) => r.companies?.name?.includes(companyName)) : rows
    if (!materialName) {
      return { total: byCompany.length, invoices: byCompany.map((r) => ({ invoice_no: r.invoice_no, status: r.invoice_status, date: r.invoice_date, company: r.companies?.name ?? "(ไม่ระบุ)", total: r.total_amount, items: r.invoice_items.map((i) => ({ desc: i.description, qty: i.qty, unit: i.unit })) })), note: "ใบแจ้งหนี้ที่ใช้งาน (ไม่นับ VOID) จาก invoices + invoice_items จริง" }
    }
    const matched = byCompany.filter((r) => r.invoice_items.some((i) => i.description?.includes(materialName)))
    if (matched.length === 0) {
      return { PARTIAL_RESULT: true, material: materialName, matched_invoices: 0, reason: "invoice_items ไม่มีคอลัมน์ material_type_id — จับคู่จากข้อความ description เท่านั้น และไม่พบรายการที่ระบุวัสดุนี้ในใบแจ้งหนี้ที่ใช้งาน (VOID ไม่นับ) ความสัมพันธ์วัสดุ-บิลระดับ master ยังไม่มีในระบบ" }
    }
    return { material: materialName, matched_invoices: matched.length, evidence: matched.map((r) => ({ invoice_no: r.invoice_no, date: r.invoice_date, company: r.companies?.name, items: r.invoice_items.filter((i) => i.description?.includes(materialName)).map((i) => ({ desc: i.description, qty: i.qty, unit: i.unit, line_total: i.line_total })) })), note: "จับคู่จาก invoice_items.description (ไม่ใช่ FK วัสดุ) — หลักฐานเบื้องต้น ตรวจสอบก่อนใช้ตัดสินใจ" }
  },
  "material.sources": async (p) => {
    const lat = Number(p.lat), lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("ต้องระบุ lat/lng ของหน้างาน");
    const nearest = await findNearestPit(lat, lng, p.material_type_id ? String(p.material_type_id) : undefined);
    if (!nearest) throw new Error("ไม่พบแหล่งวัสดุที่ระบุพิกัดได้");
    return nearest;
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
  /** sandbox ของสาย AI ผู้เรียก — เดิม (ไม่ส่ง) = Owner AI (สายทั้งหมดที่ไม่ประกาศเป็นสาย Owner เดิม) — การส่ง 'sales' = sandbox ขาย whitelist (fail-closed) */
  ctx?: { sandbox?: "owner" | "sales" },
): Promise<DispatchResult> {
  // AI SANDBOX ISOLATION (owner 2026-10-15): จุดบังคับเดียวของความสามารถทั้งหมด —
  // ก่อน lookup registry: sandbox=sales ผ่าน decideSandboxCommand (fail-closed)
  if (ctx?.sandbox === "sales") {
    const sandbox = decideSandboxCommand({ command, sandbox: "sales" });
    if (!sandbox.allowed) {
      return {
        ok: false,
        command,
        data: null,
        requires_confirmation: false,
        violations: [sandbox.reason],
      };
    }
  }
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

  const hardcode_warnings = scanPayloadForHardcodes(command, payload);

  const queryFn = QUERY_MAP[command];
  if (queryFn) {
    try {
      const data = await queryFn(payload);
      return { ok: true, command, data, requires_confirmation: false, violations: [], hardcode_warnings };
    } catch (err) {
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
