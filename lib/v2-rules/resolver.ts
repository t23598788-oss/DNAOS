import { supabase } from "@/lib/supabase/queries";

export interface FindResult {
  ok: boolean;
  found: "exact" | "ambiguous" | "none";
  record?: Record<string, unknown>;
  candidates?: Record<string, unknown>[];
  next_actions?: string[];
  error?: string;
}

// ---- DEBT FIND ----

export async function findDebt(keyword: string): Promise<FindResult> {
  const { data, error } = await supabase()
    .from("debt_trackings")
    .select("id, customer_name, principal_amount, fee_rate, interest_start_at, created_at")
    .is("deleted_at", null)
    .ilike("customer_name", `%${keyword}%`)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, found: "none", error: error.message };
  if (!data || data.length === 0) return { ok: false, found: "none", error: `ไม่พบลูกหนี้: "${keyword}"` };

  if (data.length === 1) {
    const r = data[0];
    return {
      ok: true,
      found: "exact",
      record: {
        customer_id: r.id,
        customer_name: r.customer_name,
        principal_amount: r.principal_amount,
        fee_rate: r.fee_rate,
        interest_start_at: r.interest_start_at,
      },
      next_actions: [
        `.debt detail ${r.id}`,
        `.pay preview ${r.id}`,
      ],
    };
  }

  return {
    ok: true,
    found: "ambiguous",
    candidates: data.map((r) => ({
      id: r.id,
      customer_name: r.customer_name,
      principal_amount: r.principal_amount,
    })),
    error: `พบ ${data.length} ราย กรุณาเลือก`,
  };
}

// ---- PARTNER FIND ----

export async function findPartner(keyword: string): Promise<FindResult> {
  const { data, error } = await supabase()
    .from("partners")
    .select("id, code, name, partner_type_label, phone, address")
    .is("deleted_at", null)
    .or(`name.ilike.%${keyword}%,phone.ilike.%${keyword}%,code.ilike.%${keyword}%`)
    .order("name");

  if (error) return { ok: false, found: "none", error: error.message };
  if (!data || data.length === 0) return { ok: false, found: "none", error: `ไม่พบคู่ค้า: "${keyword}"` };

  return {
    ok: true,
    found: "exact",
    record: data.length === 1
      ? { partner_id: data[0].id, code: data[0].code, name: data[0].name, type: data[0].partner_type_label, phone: data[0].phone, address: data[0].address }
      : { results: data, count: data.length },
  };
}

// ---- INVOICE FIND (by document_number or party_name) ----

export async function findInvoice(keyword: string): Promise<FindResult> {
  const { data, error } = await supabase()
    .from("documents")
    .select("id, document_number, document_type, party_name, net_amount, status, issue_date")
    .eq("document_type", "invoice")
    .is("deleted_at", null)
    .or(`document_number.ilike.%${keyword}%,party_name.ilike.%${keyword}%`)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, found: "none", error: error.message };
  if (!data || data.length === 0) return { ok: false, found: "none", error: `ไม่พบใบแจ้งหนี้: "${keyword}"` };

  if (data.length === 1) {
    const r = data[0];
    const { data: debts } = await supabase()
      .from("invoice_debts")
      .select("id, outstanding_amount, invoice_status")
      .eq("document_id", r.id);

    return {
      ok: true,
      found: "exact",
      record: {
        document_id: r.id,
        document_number: r.document_number,
        party_name: r.party_name,
        net_amount: r.net_amount,
        status: r.status,
        issue_date: r.issue_date,
        debts: debts ?? [],
        total_outstanding: (debts ?? []).reduce((sum, d) => sum + (d.outstanding_amount ?? 0), 0),
      },
      next_actions: debts?.filter((d) => d.invoice_status === "OPEN").map((d) => `.pay preview ${d.id}`) ?? [],
    };
  }

  return {
    ok: true,
    found: "ambiguous",
    candidates: data.map((r) => ({
      id: r.id,
      document_number: r.document_number,
      party_name: r.party_name,
      net_amount: r.net_amount,
      status: r.status,
    })),
    error: `พบ ${data.length} รายการ กรุณาเลือก`,
  };
}

// ---- PIT FIND (บ่อวัสดุ / โรงงาน / โรงโม่) ----

export async function findPit(keyword: string): Promise<FindResult> {
  const { data, error } = await supabase()
    .from("pit_profiles")
    .select("id, pit_name, address, latitude, longitude")
    .is("deleted_at", null)
    .ilike("pit_name", `%${keyword}%`)
    .order("pit_name");

  if (error) return { ok: false, found: "none", error: error.message };
  if (!data || data.length === 0) return { ok: false, found: "none", error: `ไม่พบแหล่งวัสดุ: "${keyword}"` };

  return {
    ok: true,
    found: "exact",
    record: { results: data, count: data.length },
  };
}

// ---- SMART FIND (ค้นหาทุก table ที่เกี่ยว) ----

export async function smartFind(keyword: string): Promise<FindResult> {
  // ลอง pit_profiles ก่อน
  const pit = await findPit(keyword);
  if (pit.ok) return pit;

  // ลอง partners
  const partner = await findPartner(keyword);
  if (partner.ok) return partner;

  // ลอง invoices
  const invoice = await findInvoice(keyword);
  if (invoice.ok) return invoice;

  // ลอง debts
  const debt = await findDebt(keyword);
  if (debt.ok) return debt;

  return { ok: false, found: "none", error: `ไม่พบข้อมูล: "${keyword}"` };
}

// ---- DISPATCH FIND ----

export async function dispatchFind(domain: string, keyword: string): Promise<FindResult> {
  switch (domain) {
    case "debt":
      return findDebt(keyword);
    case "partner":
      return smartFind(keyword);
    case "invoice":
      return findInvoice(keyword);
    case "pit":
      return findPit(keyword);
    default:
      return smartFind(keyword);
  }
}
