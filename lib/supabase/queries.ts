import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  _client = createClient(url, key);
  return _client;
}

// ---- DEBTS ----
export async function getDebts() {
  const { data, error } = await supabase()
    .from("debts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// ---- INVOICES ----
export async function getInvoices() {
  const { data, error } = await supabase()
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getLatestInvoice() {
  const { data, error } = await supabase()
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---- DOCUMENTS ----
export async function getDocuments() {
  const { data, error } = await supabase()
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
