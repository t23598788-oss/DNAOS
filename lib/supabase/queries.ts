import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  _client = createClient(url, key);
  return _client;
}

// ---- INVOICE DEBTS (หนี้ค้างชำระ) ----

export async function getOpenDebts() {
  const { data, error } = await supabase()
    .from("invoice_debts")
    .select("id, document_id, principal_amount, outstanding_amount, invoice_status, paid_amount, current_interest_amount, created_at")
    .eq("invoice_status", "OPEN")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function getAllDebts() {
  const { data, error } = await supabase()
    .from("invoice_debts")
    .select("id, document_id, principal_amount, outstanding_amount, invoice_status, paid_amount, current_interest_amount, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

// ---- DEBT TRACKINGS (ลูกหนี้แยก) ----

export async function getDebtTrackings() {
  const { data, error } = await supabase()
    .from("debt_trackings")
    .select("id, partner_id, customer_name, principal_amount, fee_rate, interest_start_at, created_at, deleted_at, partners(id, name, phone, tax_id, contact_name)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data.map((d) => ({
    ...d,
    customer_name: (d.partners as any)?.name ?? d.customer_name ?? "",
  }));
}

export async function createDebtTracking(payload: {
  partner_id: string;
  customer_name?: string;
  principal_amount: number;
  fee_rate?: number;
  interest_start_at?: string;
}) {
  const { data, error } = await supabase()
    .from("debt_trackings")
    .insert({
      partner_id: payload.partner_id,
      customer_name: payload.customer_name,
      principal_amount: payload.principal_amount,
      fee_rate: payload.fee_rate ?? 5.0,
      interest_start_at: payload.interest_start_at ?? new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getDebtTrackingById(id: string) {
  const { data, error } = await supabase()
    .from("debt_trackings")
    .select("id, partner_id, customer_name, principal_amount, fee_rate, interest_start_at, created_at, deleted_at, partners(id, name, phone, address, tax_id, contact_name)")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw new Error(error.message);
  return { ...data, customer_name: (data.partners as any)?.name ?? data.customer_name ?? "" };
}

export async function updateDebtTracking(id: string, payload: {
  partner_id?: string;
  customer_name?: string;
  principal_amount?: number;
  fee_rate?: number;
  interest_start_at?: string;
}) {
  const { data, error } = await supabase()
    .from("debt_trackings")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteDebtTracking(id: string) {
  const { error } = await supabase()
    .from("debt_trackings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---- DOCUMENT TYPE ALIASES ----
// เอกสารเก่า (สร้างผ่าน AI/cognitive pipeline) บันทึก document_type แบบขีดกลาง
// ก่อนจะเปลี่ยนมาตรฐานเป็นขีดล่าง (engine.ts DocType) — แมปไว้ที่เดียวกันทั้งกรองและนับยอด
// ไม่ใช่ business rule แค่ alias ของ key เดิมกับใหม่ที่หมายถึงเอกสารประเภทเดียวกัน
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
  const { data, error } = await supabase()
    .from("documents")
    .select("document_type")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  let otherCount = 0;
  for (const row of data) {
    const key = canonicalDocumentType(row.document_type as string);
    if (MANAGED_DOCUMENT_TYPES.includes(key)) {
      counts[key] = (counts[key] ?? 0) + 1;
    } else {
      otherCount += 1;
    }
  }
  return { counts, otherCount, total: data.length };
}

// ---- DOCUMENTS (เอกสาร: invoice, boq, delivery-order, purchase-order) ----

export async function getDocuments(docType?: string) {
  let query = supabase()
    .from("documents")
    .select("id, document_type, document_number, status, partner_id, party_name, net_amount, issue_date, source, created_at, partners(id, name)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (docType) {
    query = query.eq("document_type", docType);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data.map((d) => ({
    ...d,
    party_name: (d.partners as any)?.name ?? d.party_name ?? "",
  }));
}

export async function getLatestInvoice() {
  const { data, error } = await supabase()
    .from("documents")
    .select("id, document_number, status, party_name, party_tel, net_amount, issue_date, created_at")
    .eq("document_type", "invoice")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getFirstInvoiceForPartner(partnerId?: string | null, customerName?: string) {
  let query = supabase()
    .from("documents")
    .select("id, document_number, issue_date, due_date, created_at, partner_id, party_name")
    .eq("document_type", "invoice")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1);

  if (partnerId) {
    query = query.eq("partner_id", partnerId);
  } else if (customerName) {
    query = query.ilike("party_name", `%${customerName}%`);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getReceipts() {
  const { data, error } = await supabase()
    .from("documents")
    .select("id, document_number, status, party_name, net_amount, issue_date, created_at")
    .eq("document_type", "receipt")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
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
  const { data, error } = await supabase()
    .from("documents")
    .insert({
      document_type: payload.document_type,
      document_number: payload.document_number,
      partner_id: payload.partner_id,
      party_name: payload.party_name,
      net_amount: payload.net_amount,
      subtotal_amount: payload.net_amount,
      base_amount: payload.net_amount,
      gross_amount: payload.net_amount,
      issue_date: payload.issue_date ?? new Date().toISOString().split("T")[0],
      status: payload.status ?? "saved",
      note: payload.note,
      source: "deadboard",
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
  const { data, error } = await supabase()
    .from("partners")
    .select("id, code, name, partner_type_label, phone, address, tax_id, contact_name, created_at")
    .is("deleted_at", null)
    .ilike("name", `%${needle}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// ---- DEBTS BY CUSTOMER NAME (join invoice_debts + documents) ----

export async function getDebtsByCustomerName(name: string) {
  const needle = name.trim().toLowerCase();
  if (!needle) return { invoiceDebts: [] as Awaited<ReturnType<typeof getOpenDebts>>, debtTrackings: [] as Awaited<ReturnType<typeof getDebtTrackings>> };
  const [debts, docs, trackings] = await Promise.all([
    getOpenDebts(),
    getDocuments(),
    getDebtTrackings(),
  ]);
  const matchedDocs = docs.filter((d) => String(d.party_name ?? "").toLowerCase().includes(needle));
  const matchedDocIds = new Set(matchedDocs.map((d) => d.id));
  const invoiceDebts = debts
    .filter((d) => matchedDocIds.has(d.document_id))
    .map((d) => ({
      ...d,
      customer_name: matchedDocs.find((doc) => doc.id === d.document_id)?.party_name ?? name,
      document_number: matchedDocs.find((doc) => doc.id === d.document_id)?.document_number ?? "",
    }));
  const debtTrackings = trackings.filter((t) => String(t.customer_name ?? "").toLowerCase().includes(needle));
  return { invoiceDebts, debtTrackings };
}

// ---- JOBS (งานจัดส่ง) ----

export async function getJobs(status?: string) {
  let query = supabase()
    .from("jobs")
    .select("id, project_name, job_status, partner_id, contact_name, distance_km, required_quantity, delivered_quantity, created_at, partners(id, name)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("job_status", status);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data.map((j) => ({
    ...j,
    contact_name: (j.partners as any)?.name ?? j.contact_name ?? "",
  }));
}

// ---- PARTNERS (คู่ค้า) ----

export async function getPartners() {
  const { data, error } = await supabase()
    .from("partners")
    .select("id, code, name, partner_type_label, phone, address, tax_id, contact_name, created_at")
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

// พาร์ทเนอร์ที่ยังเป็นลูกหนี้จริง — มีเอกสาร invoice/delivery_order ที่ยังไม่ "paid"
// ใช้กรองช่องเลือกพาร์ทเนอร์ในฟอร์มติดตามหนี้ ไม่ต้องเลื่อนหาในรายชื่อพาร์ทเนอร์ทั้งหมด
const DEBTOR_DOCUMENT_TYPES = new Set(["invoice", "delivery_order"]);

export async function getDebtorPartners() {
  const { data: docs, error } = await supabase()
    .from("documents")
    .select("partner_id, party_name, document_type, status")
    .is("deleted_at", null)
    .neq("status", "paid");
  if (error) throw new Error(error.message);

  const relevant = docs.filter((d) => DEBTOR_DOCUMENT_TYPES.has(canonicalDocumentType(d.document_type as string)));
  const partnerIds = new Set(relevant.map((d) => d.partner_id).filter(Boolean) as string[]);
  const partnerNames = new Set(relevant.map((d) => String(d.party_name ?? "").trim().toLowerCase()).filter(Boolean));

  const partners = await getPartners();
  return partners.filter((p) => partnerIds.has(p.id) || partnerNames.has(p.name.trim().toLowerCase()));
}

// ---- MATERIAL TYPES (ประเภทวัสดุ) ----

export async function getMaterialTypes() {
  const { data, error } = await supabase()
    .from("material_types")
    .select("id, name")
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

// ---- PARTNER TIMELINE ----

export async function getPartnerById(id: string) {
  const { data, error } = await supabase()
    .from("partners")
    .select("id, code, name, partner_type_label, phone, address, tax_id, contact_name, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getDocumentsByPartner(partnerId: string) {
  const { data, error } = await supabase()
    .from("documents")
    .select("id, document_type, document_number, status, net_amount, issue_date, created_at")
    .eq("partner_id", partnerId)
    .is("deleted_at", null)
    .order("issue_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function getBusinessEventsByPartner(partnerId: string) {
  const { data, error } = await supabase()
    .from("business_events")
    .select("id, event_type, event_date, title, description, metadata, created_at")
    .eq("partner_id", partnerId)
    .is("deleted_at", null)
    .order("event_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getPartnersWithDocumentSummary() {
  const [partners, docs] = await Promise.all([
    getPartners(),
    supabase()
      .from("documents")
      .select("partner_id, document_type, net_amount, status, issue_date")
      .is("deleted_at", null)
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return data ?? [];
      }),
  ]);

  const summaryMap = new Map<string, { total_invoiced: number; total_received: number; count: number; last_date: string | null }>();
  for (const d of docs) {
    if (!d.partner_id) continue;
    const s = summaryMap.get(d.partner_id) ?? { total_invoiced: 0, total_received: 0, count: 0, last_date: null };
    const canonical = canonicalDocumentType(d.document_type as string);
    if (canonical === "invoice") s.total_invoiced += Number(d.net_amount ?? 0);
    if (canonical === "receipt") s.total_received += Number(d.net_amount ?? 0);
    s.count += 1;
    if (d.issue_date && (!s.last_date || d.issue_date > s.last_date)) s.last_date = d.issue_date;
    summaryMap.set(d.partner_id, s);
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

// ---- LINE DRAFT DOCUMENTS (ร่างรออนุมัติ) ----

export async function getPendingDrafts() {
  const { data, error } = await supabase()
    .from("line_draft_documents")
    .select("id, doc_type, status, payload, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}
