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
    .select("id, customer_name, principal_amount, fee_rate, interest_start_at, created_at, deleted_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function createDebtTracking(payload: {
  customer_name: string;
  principal_amount: number;
  fee_rate?: number;
  interest_start_at?: string;
}) {
  const { data, error } = await supabase()
    .from("debt_trackings")
    .insert({
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

// ---- DOCUMENTS (เอกสาร: invoice, boq, delivery-order, purchase-order) ----

export async function getDocuments(docType?: string) {
  let query = supabase()
    .from("documents")
    .select("id, document_type, document_number, status, party_name, net_amount, issue_date, source, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (docType) {
    query = query.eq("document_type", docType);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
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

// ---- JOBS (งานจัดส่ง) ----

export async function getJobs(status?: string) {
  let query = supabase()
    .from("jobs")
    .select("id, project_name, job_status, contact_name, distance_km, required_quantity, delivered_quantity, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("job_status", status);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// ---- PARTNERS (คู่ค้า) ----

export async function getPartners() {
  const { data, error } = await supabase()
    .from("partners")
    .select("id, code, name, partner_type_label, phone, address, created_at")
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(error.message);
  return data;
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
