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
  const { data, error } = await supabaseAdmin()
    .from("invoices")
    .select("id, customer_order_id, total_amount, paid_amount, invoice_status, created_at")
    .not("invoice_status", "in", '("PAID","VOID")')
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((d: any) => ({
    id: d.id,
    document_id: d.id,
    principal_amount: Number(d.total_amount ?? 0),
    outstanding_amount: Number(d.total_amount ?? 0) - Number(d.paid_amount ?? 0),
    invoice_status: "OPEN",
    paid_amount: Number(d.paid_amount ?? 0),
    current_interest_amount: 0,
    created_at: d.created_at,
  }));
}

export async function getAllDebts() {
  const { data, error } = await supabaseAdmin()
    .from("invoices")
    .select("id, customer_order_id, total_amount, paid_amount, invoice_status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((d: any) => ({
    id: d.id,
    document_id: d.id,
    principal_amount: Number(d.total_amount ?? 0),
    outstanding_amount: Number(d.total_amount ?? 0) - Number(d.paid_amount ?? 0),
    invoice_status: d.invoice_status === "PAID" ? "CLOSED" : "OPEN",
    paid_amount: Number(d.paid_amount ?? 0),
    current_interest_amount: 0,
    created_at: d.created_at,
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

export async function updateDebtTracking(id: string, payload: {
  partner_id?: string;
  customer_name?: string;
  principal_amount?: number;
  fee_rate?: number;
  interest_start_at?: string;
}) {
  const update: any = { last_refreshed_at: new Date().toISOString() };
  if (payload.partner_id) update.customer_company_id = payload.partner_id;
  if (payload.principal_amount !== undefined) {
    update.total_outstanding = payload.principal_amount;
    update.overdue_amount = payload.principal_amount;
  }
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

export async function createDocument(payload: {
  document_type: string;
  document_number: string;
  partner_id?: string;
  party_name: string;
  net_amount: number;
  issue_date?: string;
  status?: string;
  note?: string;
}) {
  if (payload.document_type === "invoice") {
    const { data, error } = await supabaseAdmin()
      .from("invoices")
      .insert({
        invoice_no: payload.document_number,
        customer_company_id: payload.partner_id ?? null,
        invoice_date: payload.issue_date ?? new Date().toISOString().split("T")[0],
        invoice_status: "DRAFT",
        total_amount: payload.net_amount,
        subtotal: payload.net_amount,
        vat_rate: 0,
        vat_amount: 0,
        paid_amount: 0,
        notes: payload.note ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabaseAdmin()
    .from("standalone_documents")
    .insert({
      document_no: payload.document_number,
      document_type: payload.document_type,
      customer_company_id: payload.partner_id ?? null,
      document_date: payload.issue_date ?? new Date().toISOString().split("T")[0],
      total_amount: payload.net_amount,
      subtotal: payload.net_amount,
      vat_rate: 0,
      vat_amount: 0,
      notes: payload.note ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

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

// ---- JOBS (transport_jobs) ----

export async function getJobs(status?: string) {
  let query = supabaseAdmin()
    .from("transport_jobs")
    .select("id, job_no, status, fleet_company_id, customer_order_id, transport_cost, created_at, companies(id, name)")
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((j: any) => ({
    id: j.id,
    project_name: j.job_no ?? "-",
    job_status: j.status ?? "-",
    partner_id: j.fleet_company_id ?? null,
    contact_name: (j.companies as any)?.name ?? "-",
    distance_km: 0,
    required_quantity: 0,
    delivered_quantity: 0,
    created_at: j.created_at,
    partners: j.companies,
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
  const [partners, invoices] = await Promise.all([
    getPartners(),
    supabaseAdmin()
      .from("invoices")
      .select("customer_company_id, total_amount, paid_amount, invoice_status, invoice_date")
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return data ?? [];
      }),
  ]);

  const summaryMap = new Map<string, { total_invoiced: number; total_received: number; count: number; last_date: string | null }>();
  for (const d of invoices) {
    if (!d.customer_company_id) continue;
    const s = summaryMap.get(d.customer_company_id) ?? { total_invoiced: 0, total_received: 0, count: 0, last_date: null };
    s.total_invoiced += Number(d.total_amount ?? 0);
    s.total_received += Number(d.paid_amount ?? 0);
    s.count += 1;
    if (d.invoice_date && (!s.last_date || d.invoice_date > s.last_date)) s.last_date = d.invoice_date;
    summaryMap.set(d.customer_company_id, s);
  }

  return partners.map((p) => {
    const s = summaryMap.get(p.id) ?? { total_invoiced: 0, total_received: 0, count: 0, last_date: null };
    return {
      ...p,
      total_invoiced: s.total_invoiced,
      total_received: s.total_received,
      outstanding: s.total_invoiced - s.total_received,
      document_count: s.count,
      last_activity: s.last_date,
    };
  });
}

// ---- LINE DRAFT DOCUMENTS ----

export async function getPendingDrafts() {
  return [];
}
