import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;
let _adminClient: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  _client = createClient(url, key);
  return _client;
}

// Service role client — ใช้ใน server-side API routes เท่านั้น
// bypass RLS ทุกตาราง (ห้ามใช้ใน client components)
export function supabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  _adminClient = createClient(url, key, { auth: { persistSession: false } });
  return _adminClient;
}

// ---- HELPERS: map new schema → old interface ----

function mapCompanyToPartner(c: any) {
  return {
    id: c.id,
    code: c.id?.slice(0, 8) ?? "",
    name: c.name ?? "",
    partner_type_label: c.type ?? "",
    phone: c.phone ?? "",
    address: c.address ?? "",
    tax_id: c.tax_id ?? "",
    contact_name: c.email ?? "",
    pit_profile_id: null,
    created_at: c.created_at,
  };
}

function mapInvoiceToDocument(d: any) {
  return {
    id: d.id,
    document_type: "invoice",
    document_number: d.invoice_no ?? "",
    status: d.invoice_status?.toLowerCase() ?? "draft",
    partner_id: d.customer_company_id ?? null,
    party_name: d.companies?.name ?? d.customer_company_id ?? "",
    net_amount: Number(d.total_amount ?? 0),
    issue_date: d.invoice_date ?? null,
    source: "deadboard",
    created_at: d.created_at,
    transaction_id: d.customer_order_id ?? null,
    business_event_id: null,
    reference_number: d.reference_no ?? null,
    partners: d.companies ? { id: d.companies.id, name: d.companies.name, phone: d.companies.phone ?? "" } : null,
  };
}

function mapStandaloneToDocument(d: any) {
  return {
    id: d.id,
    document_type: (d.document_type ?? "document").toLowerCase(),
    document_number: d.document_no ?? "",
    status: d.status ?? "draft",
    partner_id: d.customer_company_id ?? null,
    party_name: d.companies?.name ?? "",
    net_amount: Number(d.total_amount ?? 0),
    issue_date: d.document_date ?? null,
    source: "deadboard",
    created_at: d.created_at,
    transaction_id: d.customer_order_id ?? null,
    business_event_id: null,
    reference_number: d.reference_no ?? null,
    partners: d.companies ? { id: d.companies.id, name: d.companies.name, phone: d.companies.phone ?? "" } : null,
  };
}

// ---- INVOICE DEBTS (ดึงจาก invoices ที่ยังไม่ paid) ----

export async function getOpenDebts() {
  // PHASE E5.2 — reads the canonical views: the receivable comes from
  // invoice_payment_summary (persisted net_payable/gross + allocation-derived paid),
  // never from re-deriving it out of `total_amount`. `current_interest_amount` stays
  // 0 because the ledger does not accrue interest — it only records what was received.
  const { data, error } = await supabaseAdmin()
    .from("invoice_payment_summary")
    .select("invoice_id, invoice_no, receivable_amount, receivable_basis, paid_amount, outstanding, derived_status")
    .not("derived_status", "in", '("VOID","PAID")')
    .gt("outstanding", 0);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  // FIELD GAPS FIXED (owner mission 2026-10-15 — debt.list → Workspace): the
  // presentation layer needs the COMPANY name and the INVOICE DATE. The view
  // doesn't carry them, so read them from the same underlying invoices it is
  // built on (companies FK embed) — read-only, no new table/view/shape.
  const meta = new Map<string, { name: string; date: string | null }>();
  const ids = rows.map((d: any) => d.invoice_id);
  if (ids.length > 0) {
    const { data: inv, error: invErr } = await supabaseAdmin()
      .from("invoices")
      .select("id, invoice_date, companies(name)")
      .in("id", ids);
    if (!invErr) {
      for (const r of inv ?? []) {
        meta.set(r.id, {
          name: (r as any).companies?.name ?? "",
          date: (r as any).invoice_date ?? null,
        });
      }
    }
    // a failed meta read leaves name/date empty — canonical amounts/status stay authoritative
  }
  return rows.map((d: any) => {
    const m = meta.get(d.invoice_id) ?? { name: "", date: null };
    return {
      id: d.invoice_id,
      document_id: d.invoice_id,
      document_number: d.invoice_no,
      customer_name: m.name,
      issue_date: m.date,
      principal_amount: Number(d.receivable_amount ?? 0),
      outstanding_amount: Number(d.outstanding ?? 0),
      invoice_status: "OPEN",
      derived_status: d.derived_status ?? null,
      paid_amount: Number(d.paid_amount ?? 0),
      current_interest_amount: 0,
      receivable_basis: d.receivable_basis,
      created_at: null,
    };
  });
}

export async function getAllDebts() {
  // PHASE E5.2 — same canonical view as getOpenDebts (all statuses, VOID included so
  // the history stays complete). Amounts are the persisted receivable + allocation-derived
  // paid amount; nothing is recomputed from `total_amount`.
  const { data, error } = await supabaseAdmin()
    .from("invoice_payment_summary")
    .select("invoice_id, invoice_no, receivable_amount, receivable_basis, paid_amount, outstanding, derived_status");
  if (error) throw new Error(error.message);
  return (data ?? []).map((d: any) => ({
    id: d.invoice_id,
    document_id: d.invoice_id,
    document_number: d.invoice_no,
    principal_amount: Number(d.receivable_amount ?? 0),
    outstanding_amount: Number(d.outstanding ?? 0),
    invoice_status: d.derived_status === "PAID" || d.derived_status === "VOID" ? "CLOSED" : "OPEN",
    paid_amount: Number(d.paid_amount ?? 0),
    current_interest_amount: 0,
    receivable_basis: d.receivable_basis,
    created_at: null,
  }));
}

// ---- DEBT TRACKINGS (ดึงจาก debt_snapshots) ----

export async function getDebtTrackings() {
  const { data, error } = await supabaseAdmin()
    .from("debt_snapshots")
    .select("id, customer_company_id, total_outstanding, overdue_amount, collection_state, debt_start_at, created_at, freeze_from, freeze_until, companies(id, name, phone, tax_id)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((d: any) => ({
    id: d.id,
    partner_id: d.customer_company_id,
    customer_name: d.companies?.name ?? d.customer_company_id ?? "",
    principal_amount: Number(d.total_outstanding ?? 0),
    fee_rate: 0,
    interest_start_at: d.debt_start_at ?? d.created_at,
    // Debt Collection Freeze Window (owner, 2026-07-18) — was silently
    // dropped here, so /admin/debt-tracking showed stale un-frozen numbers
    // (61 days interest / 31 days penalty) while every other consumer
    // (reminder card, relationships list, credit score) already respected
    // the freeze. This is the plumbing gap that caused that mismatch.
    freeze_from: d.freeze_from ?? null,
    freeze_until: d.freeze_until ?? null,
    created_at: d.created_at,
    deleted_at: null,
    partners: d.companies ? { id: d.companies.id, name: d.companies.name, phone: d.companies.phone ?? "", tax_id: d.companies.tax_id ?? "", contact_name: "" } : null,
  }));
}

export async function createDebtTracking(payload: {
  partner_id: string;
  customer_name?: string;
  principal_amount: number;
  fee_rate?: number;
  interest_start_at?: string;
}) {
  const { data, error } = await supabaseAdmin()
    .from("debt_snapshots")
    .insert({
      customer_company_id: payload.partner_id,
      total_outstanding: payload.principal_amount,
      overdue_amount: payload.principal_amount,
      collection_state: "CURRENT", // public."CollectionState": CURRENT|OVERDUE|WARNING|COLLECTION|PROMISED|PARTIAL|LEGAL|CLOSED
      debt_start_at: payload.interest_start_at ?? new Date().toISOString(),
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getDebtTrackingById(id: string) {
  const { data, error } = await supabaseAdmin()
    .from("debt_snapshots")
    .select("id, customer_company_id, total_outstanding, overdue_amount, collection_state, debt_start_at, created_at, companies(id, name, phone, address, tax_id)")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return {
    id: data.id,
    partner_id: data.customer_company_id,
    customer_name: (data.companies as any)?.name ?? "",
    principal_amount: Number(data.total_outstanding ?? 0),
    fee_rate: 0,
    interest_start_at: data.debt_start_at ?? data.created_at,
    created_at: data.created_at,
    deleted_at: null,
    partners: data.companies,
  };
}

// FREEZE — Owner decision ⑤a-B (2026-09-24): PATCH writer = configuration columns
// เท่านั้น. สาขาเขียนคอลัมน์ยอดหนี้ (money columns) ถูกถอดออกจาก legacy authority
// นี้แล้ว — LEGACY_DEBT_PATCH_DIRECT_MONEY_OVERWRITE = 0 · negative control =
// scripts/debt-patch-freeze-test.ts · ยอดหนี้เปลี่ยนผ่าน canonical debt_events ผ่าน
// /api/admin/debt-trackings/[id]/events เท่านั้น. ไม่มี semantics ใหม่ — CREATE/DELETE
// คงรูปเดิม = DEFERRED_DEBT_MODEL_DECISION · debt-write contract คงเดิม · B-05 ห้ามแตะ.
export async function updateDebtTracking(id: string, payload: {
  partner_id?: string;
  customer_name?: string;
  fee_rate?: number;
  interest_start_at?: string;
}) {
  const update: any = { last_refreshed_at: new Date().toISOString() };
  if (payload.partner_id) update.customer_company_id = payload.partner_id;
  if (payload.interest_start_at) update.debt_start_at = payload.interest_start_at;

  const { data, error } = await supabaseAdmin()
    .from("debt_snapshots")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteDebtTracking(id: string) {
  const { error } = await supabaseAdmin()
    .from("debt_snapshots")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---- DOCUMENT TYPE ALIASES ----
const DOCUMENT_TYPE_ALIASES: Record<string, string> = {
  "purchase-order": "purchase_order",
  "delivery-order": "delivery_order",
  "payment-voucher": "payment_voucher",
};

const REVERSE_DOCUMENT_TYPE_ALIASES: Record<string, string[]> = {};
for (const [legacy, canonical] of Object.entries(DOCUMENT_TYPE_ALIASES)) {
  (REVERSE_DOCUMENT_TYPE_ALIASES[canonical] ??= []).push(legacy);
}

export function canonicalDocumentType(raw: string): string {
  return DOCUMENT_TYPE_ALIASES[raw] ?? raw;
}

export function documentTypeVariants(canonical: string): string[] {
  return [canonical, ...(REVERSE_DOCUMENT_TYPE_ALIASES[canonical] ?? [])];
}

const MANAGED_DOCUMENT_TYPES = ["invoice", "purchase_order", "delivery_order", "payment_voucher", "debt_notice", "receipt"];

export async function getDocumentTypeCounts(): Promise<{ counts: Record<string, number>; otherCount: number; total: number }> {
  const [invoicesRes, standaloneRes] = await Promise.all([
    supabaseAdmin().from("invoices").select("id", { count: "exact", head: true }),
    supabaseAdmin().from("standalone_documents").select("document_type"),
  ]);

  const counts: Record<string, number> = {
    invoice: invoicesRes.count ?? 0,
  };

  let otherCount = 0;
  for (const row of (standaloneRes.data ?? [])) {
    const key = canonicalDocumentType((row.document_type as string) ?? "");
    if (MANAGED_DOCUMENT_TYPES.includes(key)) {
      counts[key] = (counts[key] ?? 0) + 1;
    } else {
      otherCount += 1;
    }
  }

  const total = Object.values(counts).reduce((s, n) => s + n, 0) + otherCount;
  return { counts, otherCount, total };
}

// ---- DOCUMENTS (mapped from invoices + standalone_documents) ----

export async function getDocuments(docType?: string) {
  const canonical = docType ? canonicalDocumentType(docType) : null;

  if (!canonical || canonical === "invoice") {
    const { data, error } = await supabaseAdmin()
      .from("invoices")
      .select("id, invoice_no, invoice_status, customer_company_id, customer_order_id, invoice_date, total_amount, paid_amount, reference_no, created_at, companies(id, name)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const invoiceDocs = (data ?? []).map(mapInvoiceToDocument);
    if (canonical === "invoice") return invoiceDocs;

    // ดึง standalone_documents ด้วยถ้าไม่ระบุ type
    const { data: sdData, error: sdErr } = await supabaseAdmin()
      .from("standalone_documents")
      // standalone_documents has TWO FKs into companies (customer_company_id,
      // partner_company_id) — confirmed via live schema inspection
      // (2026-07-14) — PostgREST can't auto-embed an ambiguous relationship,
      // hence the explicit constraint-name hint, same pattern getTransactions()
      // already uses for customer_orders' own ambiguous companies FK.
      .select("id, document_no, document_type, document_date, customer_company_id, total_amount, reference_no, created_at, customer_order_id, companies!standalone_documents_customer_company_id_fkey(id, name)")
      .order("created_at", { ascending: false });
    if (sdErr) throw new Error(sdErr.message);
    const standaloneDocs = (sdData ?? []).map(mapStandaloneToDocument);
    return [...invoiceDocs, ...standaloneDocs].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  // non-invoice types → standalone_documents
  const { data, error } = await supabaseAdmin()
    .from("standalone_documents")
    // Same ambiguous-FK fix as above — standalone_documents has two FKs into
    // companies, explicit constraint hint required.
    .select("id, document_no, document_type, document_date, customer_company_id, total_amount, reference_no, created_at, customer_order_id, companies!standalone_documents_customer_company_id_fkey(id, name)")
    .eq("document_type", canonical)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapStandaloneToDocument);
}

export async function getLatestInvoice() {
  const { data, error } = await supabaseAdmin()
    .from("invoices")
    .select("id, invoice_no, invoice_status, customer_company_id, total_amount, paid_amount, invoice_date, created_at, companies(name, phone)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    document_number: data.invoice_no,
    status: data.invoice_status?.toLowerCase(),
    party_name: (data.companies as any)?.name ?? "",
    party_tel: (data.companies as any)?.phone ?? "",
    net_amount: Number(data.total_amount ?? 0),
    issue_date: data.invoice_date,
    created_at: data.created_at,
  };
}

export async function getFirstInvoiceForPartner(partnerId?: string | null, customerName?: string) {
  let query = supabaseAdmin()
    .from("invoices")
    .select("id, invoice_no, invoice_date, created_at, customer_company_id, companies(name)")
    .order("created_at", { ascending: true })
    .limit(1);

  if (partnerId) {
    query = query.eq("customer_company_id", partnerId);
  } else if (customerName) {
    const { data: companies } = await supabaseAdmin()
      .from("companies")
      .select("id")
      .ilike("name", `%${customerName.trim()}%`)
      .limit(1);
    if (!companies?.length) return null;
    query = query.eq("customer_company_id", companies[0].id);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    document_number: data.invoice_no,
    issue_date: data.invoice_date,
    due_date: null,
    created_at: data.created_at,
    partner_id: data.customer_company_id,
    party_name: (data.companies as any)?.name ?? "",
  };
}

export async function getReceipts() {
  const { data, error } = await supabaseAdmin()
    .from("invoices")
    .select("id, invoice_no, invoice_status, total_amount, invoice_date, receipt_no, created_at, companies(name)")
    .eq("invoice_status", "PAID")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((d: any) => ({
    id: d.id,
    document_number: d.receipt_no ?? d.invoice_no,
    status: "paid",
    party_name: d.companies?.name ?? "",
    net_amount: Number(d.total_amount ?? 0),
    issue_date: d.invoice_date,
    created_at: d.created_at,
  }));
}

// PHASE C (2026-09-23) — RETIRE: the legacy `createDocument(payload)` that used to
// live here was deleted. It was a second document-creation entry (direct
// `.from("invoices")` / `.from("standalone_documents")` inserts, caller-supplied
// net_amount as the totals authority, no items/version/audit) and the caller
// census proved ZERO runtime callers: the only same-named consumer,
// app/api/admin/documents/route.ts, imports the canonical
// `engines/canonical/document-write#createDocument` (see its import block). The
// canonical writer is now the single creation entry point for these tables.

// ---- PARTNER BY NAME (fuzzy match) ----

export async function getPartnerByName(name: string) {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const { data, error } = await supabaseAdmin()
    .from("companies")
    .select("id, name, type, phone, address, tax_id, email, created_at")
    .ilike("name", `%${needle}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapCompanyToPartner(data);
}

// ---- DEBTS BY CUSTOMER NAME ----

export async function getDebtsByCustomerName(name: string) {
  const needle = name.trim().toLowerCase();
  if (!needle) return { invoiceDebts: [] as Awaited<ReturnType<typeof getOpenDebts>>, debtTrackings: [] as Awaited<ReturnType<typeof getDebtTrackings>> };

  const { data: companies } = await supabaseAdmin()
    .from("companies")
    .select("id, name")
    .ilike("name", `%${needle}%`);

  if (!companies?.length) return { invoiceDebts: [], debtTrackings: [] };
  const companyIds = companies.map((c: any) => c.id);

  const [allDebts, allTrackings] = await Promise.all([
    getOpenDebts(),
    getDebtTrackings(),
  ]);

  const invoiceDebts = allDebts.filter((d: any) => companyIds.includes(d.document_id));
  const debtTrackings = allTrackings.filter((t: any) => companyIds.includes(t.partner_id));
  return { invoiceDebts, debtTrackings };
}

// ---- JOBS (public.jobs — LIVE table; transport_jobs does NOT exist) ----
//
// Repaired against the LIVE schema (verified read-only 2026-09-23 through the
// project's PostgREST schema cache): public.transport_jobs returns
// PGRST205 "Could not find the table" while public.jobs EXISTS with real rows.
// The returned shape below is byte-for-byte the SAME contract this function
// already promised (id / project_name / job_status / partner_id / contact_name /
// distance_km / required_quantity / delivered_quantity / created_at / partners)
// — only the SOURCE changed, and three fields that were previously hardcoded 0
// (distance_km / required_quantity / delivered_quantity) now carry the real
// persisted values.
//
// OWNER DECISION (2026-09-23): `deleted_at IS NOT NULL` means the job has been
// soft-deleted, so it must NOT appear in the current job list — this query is
// therefore scoped to `deleted_at IS NULL` for BOTH job.list and job.active.
// LIVE facts at the time of the decision: 18 rows total, 11 soft-deleted,
// 7 live (SUSPENDED 3 / PENDING_REVIEW 3 / COMPLETED 1); all 6 IN_PROGRESS rows
// were in the soft-deleted group, so job.active legitimately returns [] until a
// live IN_PROGRESS job exists again — no fallback ever re-admits a deleted row.
//
// NOT ADDED (still out of scope): a join for `partners` — LIVE has no FK from
// jobs to companies/partners (PostgREST relationship resolution returns
// PGRST200 for every candidate), so `partner_id` is returned as the canonical
// reference and `partners` stays null instead of a guessed client-side join.
export async function getJobs(status?: string) {
  let query = supabaseAdmin()
    .from("jobs")
    .select("id, project_name, job_status, partner_id, contact_name, distance_km, required_quantity, delivered_quantity, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("job_status", status);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((j: any) => ({
    id: j.id,
    project_name: j.project_name ?? "-",
    job_status: j.job_status ?? "-",
    partner_id: j.partner_id ?? null,
    contact_name: j.contact_name ?? "-",
    distance_km: j.distance_km ?? 0,
    required_quantity: j.required_quantity ?? 0,
    delivered_quantity: j.delivered_quantity ?? 0,
    created_at: j.created_at,
    partners: null,
  }));
}

// ---- PARTNERS (companies) ----

export async function getPartners() {
  const { data, error } = await supabaseAdmin()
    .from("companies")
    .select("id, name, type, phone, address, tax_id, email, created_at")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapCompanyToPartner);
}

export async function getDebtorPartners() {
  const { data: invoices, error } = await supabaseAdmin()
    .from("invoices")
    .select("customer_company_id")
    .not("invoice_status", "in", '("PAID","VOID")');
  if (error) throw new Error(error.message);

  const partnerIds = new Set((invoices ?? []).map((d: any) => d.customer_company_id).filter(Boolean) as string[]);
  const partners = await getPartners();
  return partners.filter((p) => partnerIds.has(p.id));
}

// ---- MATERIAL TYPES ----

export async function getMaterialTypes() {
  // Was querying a "products" table that doesn't exist in this schema (always
  // silently returned [] via the error path) — the real table is
  // material_types (confirmed via live schema query), the same one
  // engines/quote-price.ts and engines/material-resolver.ts already read.
  const { data, error } = await supabaseAdmin()
    .from("material_types")
    .select("id, name")
    .order("name");
  if (error) return [];
  return (data ?? []).map((d: any) => ({ id: d.id, name: d.name }));
}

// Real GPS lookup for a company — used to price a quotation by nearest pit
// (engines/quote-price.ts's tryQuoteMaterialPrice requires real coordinates,
// never guesses a location). Same join path as the client-side "last known
// location" logic in app/admin/line-customers/page.tsx, done server-side:
// companies -> company_line_links -> most recent line_events location.
export async function getCustomerGps(customerId: string): Promise<{ lat: number; lng: number } | null> {
  if (!customerId) return null
  const db = supabaseAdmin()
  const { data: link } = await db
    .from("company_line_links")
    .select("line_user_id")
    .eq("company_id", customerId)
    .maybeSingle()

  if (link?.line_user_id) {
    const { data: rows } = await db
      .from("line_events")
      .select("extracted")
      .eq("line_user_id", link.line_user_id)
      .eq("raw_type", "location")
      .order("created_at", { ascending: false })
      .limit(1)

    const extracted = rows?.[0]?.extracted as { latitude?: number; longitude?: number } | null
    if (extracted?.latitude && extracted?.longitude) {
      return { lat: extracted.latitude, lng: extracted.longitude }
    }
  }

  // Fallback (owner, 2026-07-24): a live LINE location-share pin is the
  // primary source, but a customer_sites row geocoded from typed text
  // (engines/jobs/auto-create.ts's tryCreateSiteFromText, via
  // engines/geocoding.ts) is real coordinate evidence too — without this,
  // a text-only address could never be priced at all, even after real
  // geocoding succeeded. Most recently active site wins, same recency rule
  // as the LINE-location path above.
  const { data: sites } = await db
    .from("customer_sites")
    .select("gps_lat, gps_lng")
    .eq("customer_company_id", customerId)
    .eq("is_active", true)
    .not("gps_lat", "is", null)
    .not("gps_lng", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)

  const site = sites?.[0] as { gps_lat?: number; gps_lng?: number } | undefined
  if (site?.gps_lat && site?.gps_lng) {
    return { lat: site.gps_lat, lng: site.gps_lng }
  }

  return null
}

// ---- PARTNER TIMELINE ----

export async function getPartnerById(id: string) {
  const { data, error } = await supabaseAdmin()
    .from("companies")
    .select("id, name, type, phone, address, tax_id, email, created_at")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return mapCompanyToPartner(data);
}

export async function getDocumentsByPartner(partnerId: string) {
  const { data, error } = await supabaseAdmin()
    .from("invoices")
    .select("id, invoice_no, invoice_status, total_amount, invoice_date, created_at, customer_order_id")
    .eq("customer_company_id", partnerId)
    .order("invoice_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((d: any) => ({
    id: d.id,
    document_type: "invoice",
    document_number: d.invoice_no,
    status: d.invoice_status?.toLowerCase() ?? "draft",
    net_amount: Number(d.total_amount ?? 0),
    issue_date: d.invoice_date,
    created_at: d.created_at,
    transaction_id: d.customer_order_id ?? null,
    business_event_id: null,
  }));
}

export async function getBusinessEventsByPartner(partnerId: string) {
  const { data, error } = await supabaseAdmin()
    .from("business_events")
    .select("id, event_type, event_date, title, description, metadata, created_at, transaction_id")
    .eq("partner_id", partnerId)
    .order("event_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((e: any) => ({
    id: e.id,
    event_type: e.event_type ?? "note",
    event_date: e.event_date ?? e.created_at?.split("T")[0] ?? new Date().toISOString().slice(0, 10),
    title: e.title ?? null,
    description: e.description ?? null,
    metadata: e.metadata ?? {},
    created_at: e.created_at,
    transaction_id: e.transaction_id ?? null,
  }));
}

// ---- TRANSACTIONS (customer_orders as the state machine equivalent) ----

export async function getTransactions(filters?: {
  partnerId?: string;
  txType?: string;
  state?: string;
  excludeClosed?: boolean;
}) {
  let query = supabaseAdmin()
    .from("customer_orders")
    .select("id, order_no, status, customer_company_id, project_id, created_at, updated_at, companies!customer_orders_customer_company_id_fkey(id, name, phone)")
    .order("updated_at", { ascending: false });

  if (filters?.partnerId) query = query.eq("customer_company_id", filters.partnerId);
  if (filters?.state) query = query.eq("status", filters.state);
  if (filters?.excludeClosed) query = query.neq("status", "PAID");

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((t: any) => ({
    id: t.id,
    title: t.order_no ?? "คำสั่งซื้อ",
    tx_type: "sale",
    state: t.status ?? "DRAFT",
    state_changed_at: t.updated_at ?? t.created_at,
    net_amount: null,
    paid_amount: null,
    vat_amount: null,
    project_name: null,
    created_at: t.created_at,
    partner_id: t.customer_company_id,
    supplier_id: null,
    supplier_name: null,
    partners: t.companies ?? null,
  }));
}

export async function getTransactionById(id: string) {
  const [txRes, invoicesRes] = await Promise.all([
    supabaseAdmin()
      .from("customer_orders")
      .select("id, order_no, status, customer_company_id, project_id, customer_site_id, created_at, updated_at, companies!customer_orders_customer_company_id_fkey(id, name, phone, address)")
      .eq("id", id)
      .single(),
    supabaseAdmin()
      .from("invoices")
      .select("id, invoice_no, invoice_status, total_amount, invoice_date, created_at")
      .eq("customer_order_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (txRes.error) throw new Error(txRes.error.message);
  const tx = txRes.data;
  return {
    transaction: {
      id: tx.id,
      title: tx.order_no ?? "คำสั่งซื้อ",
      tx_type: "sale",
      state: tx.status,
      state_changed_at: tx.updated_at ?? tx.created_at,
      net_amount: null,
      paid_amount: null,
      vat_amount: null,
      project_name: null,
      created_at: tx.created_at,
      updated_at: tx.updated_at,
      partner_id: tx.customer_company_id,
      supplier_id: null,
      supplier_name: null,
      metadata: {},
      partners: tx.companies ?? null,
      suppliers: null,
    },
    events: [],
    documents: (invoicesRes.data ?? []).map((d: any) => ({
      id: d.id,
      document_type: "invoice",
      document_number: d.invoice_no,
      status: d.invoice_status?.toLowerCase(),
      net_amount: Number(d.total_amount ?? 0),
      issue_date: d.invoice_date,
      created_at: d.created_at,
    })),
  };
}

export async function getPartnersWithDocumentSummary() {
  // PHASE E5.2 — canonical sources: receivables from invoice_payment_summary
  // (persisted net/gross per document) and received amounts from
  // payment_allocations. The old version summed `total_amount` and subtracted the
  // always-zero `paid_amount`, so every partner looked fully outstanding.
  const [partners, summaries, allocations] = await Promise.all([
    getPartners(),
    supabaseAdmin()
      .from("invoice_payment_summary")
      .select("invoice_id, receivable_amount, paid_amount, outstanding")
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return data ?? [];
      }),
    supabaseAdmin()
      .from("payment_allocations")
      .select("amount, invoice_id")
      .not("invoice_id", "is", null)
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return data ?? [];
      }),
  ])

  const { data: invoiceOwners } = await supabaseAdmin()
    .from("invoices")
    .select("id, customer_company_id, invoice_date")
  const ownerById = new Map((invoiceOwners ?? []).map((i: any) => [String(i.id), i]))

  const summaryMap = new Map<string, { total_invoiced: number; total_received: number; count: number; last_date: string | null }>();
  for (const s of summaries) {
    const owner = ownerById.get(String(s.invoice_id))
    if (!owner?.customer_company_id) continue
    const acc = summaryMap.get(owner.customer_company_id) ?? { total_invoiced: 0, total_received: 0, count: 0, last_date: null };
    acc.total_invoiced += Number(s.receivable_amount ?? 0);
    acc.total_received += Number(s.paid_amount ?? 0);
    acc.count += 1;
    if (owner.invoice_date && (!acc.last_date || owner.invoice_date > acc.last_date)) acc.last_date = owner.invoice_date;
    summaryMap.set(owner.customer_company_id, acc);
  }

  // allocations are the truth for money received; they are attributed to the owning company
  const receivedByCompany = new Map<string, number>();
  for (const a of allocations) {
    const owner = ownerById.get(String(a.invoice_id));
    if (!owner?.customer_company_id) continue;
    receivedByCompany.set(owner.customer_company_id, (receivedByCompany.get(owner.customer_company_id) ?? 0) + Number(a.amount ?? 0));
  }

  return partners.map((p) => {
    const s = summaryMap.get(p.id) ?? { total_invoiced: 0, total_received: 0, count: 0, last_date: null };
    const allocated = Math.round((receivedByCompany.get(p.id) ?? 0) * 100) / 100;
    return {
      ...p,
      total_invoiced: Math.round(s.total_invoiced * 100) / 100,
      total_received: allocated,
      outstanding: Math.round((s.total_invoiced - allocated) * 100) / 100,
      document_count: s.count,
      last_activity: s.last_date,
      payment_basis: "payment_allocations",
    };
  });
}

// ---- LINE DRAFT DOCUMENTS ----

export async function getPendingDrafts() {
  return [];
}
