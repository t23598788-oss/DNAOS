import { supabase } from "@/lib/supabase/queries";

// ---- Types ----

export interface ActionRequest {
  action: string;
  mode: "preview" | "execute";
  payload: Record<string, unknown>;
}

export interface ActionResponse {
  ok: boolean;
  mode: "preview" | "execute";
  action: string;
  preview?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
}

// ---- PAYMENT ----

export async function previewPayment(invoiceDebtId: string): Promise<ActionResponse> {
  const { data: debt, error: debtErr } = await supabase()
    .from("invoice_debts")
    .select("id, document_id, principal_amount, outstanding_amount, invoice_status, paid_amount, current_interest_amount")
    .eq("id", invoiceDebtId)
    .single();

  if (debtErr || !debt) {
    return { ok: false, mode: "preview", action: "payment", error: debtErr?.message ?? "ไม่พบหนี้" };
  }

  const { data: doc } = await supabase()
    .from("documents")
    .select("document_number, party_name, net_amount")
    .eq("id", debt.document_id)
    .single();

  return {
    ok: true,
    mode: "preview",
    action: "payment",
    preview: {
      invoice_debt_id: debt.id,
      document_number: doc?.document_number ?? "-",
      party_name: doc?.party_name ?? "-",
      principal_amount: debt.principal_amount,
      outstanding_amount: debt.outstanding_amount,
      current_interest: debt.current_interest_amount,
      paid_so_far: debt.paid_amount,
      status: debt.invoice_status,
      will_change: {
        invoice_status: "OPEN → PAID",
        outstanding_amount: `${debt.outstanding_amount} → 0`,
        triggers: ["back-to-back webhook จะยิงอัตโนมัติ", "LINE Notify แจ้งเจ้าของ"],
      },
    },
  };
}

export async function executePayment(payload: {
  invoice_debt_id: string;
  payment_amount: number;
  note?: string;
}): Promise<ActionResponse> {
  if (!payload.invoice_debt_id || !payload.payment_amount) {
    return { ok: false, mode: "execute", action: "payment", error: "ต้องระบุ invoice_debt_id และ payment_amount" };
  }

  const { data: debt, error: debtErr } = await supabase()
    .from("invoice_debts")
    .select("id, outstanding_amount, invoice_status")
    .eq("id", payload.invoice_debt_id)
    .single();

  if (debtErr || !debt) {
    return { ok: false, mode: "execute", action: "payment", error: debtErr?.message ?? "ไม่พบหนี้" };
  }

  if (debt.invoice_status === "PAID") {
    return { ok: false, mode: "execute", action: "payment", error: "หนี้นี้ชำระแล้ว" };
  }

  const { data: payment, error: payErr } = await supabase()
    .from("invoice_payments")
    .insert({
      invoice_debt_id: payload.invoice_debt_id,
      payment_amount: payload.payment_amount,
      paid_at: new Date().toISOString(),
      principal_before_payment: debt.outstanding_amount,
      outstanding_before_payment: debt.outstanding_amount,
      outstanding_after_payment: Math.max(0, debt.outstanding_amount - payload.payment_amount),
      note: payload.note ?? null,
    })
    .select()
    .single();

  if (payErr) {
    return { ok: false, mode: "execute", action: "payment", error: payErr.message };
  }

  const newOutstanding = Math.max(0, debt.outstanding_amount - payload.payment_amount);
  const newStatus = newOutstanding <= 0 ? "PAID" : "OPEN";

  await supabase()
    .from("invoice_debts")
    .update({
      paid_amount: payload.payment_amount,
      outstanding_amount: newOutstanding,
      invoice_status: newStatus,
      paid_at: newStatus === "PAID" ? new Date().toISOString() : null,
    })
    .eq("id", payload.invoice_debt_id);

  return {
    ok: true,
    mode: "execute",
    action: "payment",
    result: {
      payment_id: payment.id,
      amount_paid: payload.payment_amount,
      outstanding_after: newOutstanding,
      new_status: newStatus,
    },
  };
}

// ---- DOCUMENT CREATE ----

export async function previewDocumentCreate(payload: Record<string, unknown>): Promise<ActionResponse> {
  const required = ["document_type", "party_name", "net_amount"];
  const missing = required.filter((f) => !payload[f]);
  if (missing.length > 0) {
    return { ok: false, mode: "preview", action: "document.create", error: `ขาดข้อมูล: ${missing.join(", ")}` };
  }

  return {
    ok: true,
    mode: "preview",
    action: "document.create",
    preview: {
      document_type: payload.document_type,
      party_name: payload.party_name,
      net_amount: payload.net_amount,
      issue_date: payload.issue_date ?? new Date().toISOString().split("T")[0],
      note: payload.note ?? null,
      will_create: {
        table: "documents",
        source: "deadboard",
        triggers: ["document_items sync (ถ้ามี items)", "back-to-back webhook เมื่อ confirm"],
      },
    },
  };
}

export async function executeDocumentCreate(payload: {
  document_type: string;
  document_number?: string;
  party_name: string;
  net_amount: number;
  issue_date?: string;
  note?: string;
}): Promise<ActionResponse> {
  const prefix = payload.document_type === "invoice" ? "INV" : payload.document_type === "receipt" ? "REC" : "DOC";
  const docNum = payload.document_number ?? `${prefix}-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${String(Date.now()).slice(-3)}`;

  const { data, error } = await supabase()
    .from("documents")
    .insert({
      document_type: payload.document_type,
      document_number: docNum,
      party_name: payload.party_name,
      net_amount: payload.net_amount,
      subtotal_amount: payload.net_amount,
      base_amount: payload.net_amount,
      gross_amount: payload.net_amount,
      issue_date: payload.issue_date ?? new Date().toISOString().split("T")[0],
      status: "saved",
      note: payload.note,
      source: "deadboard",
    })
    .select()
    .single();

  if (error) {
    return { ok: false, mode: "execute", action: "document.create", error: error.message };
  }

  return {
    ok: true,
    mode: "execute",
    action: "document.create",
    result: { id: data.id, document_number: data.document_number, status: data.status },
  };
}

// ---- DEBT TRACKING CREATE ----

export async function previewDebtCreate(payload: Record<string, unknown>): Promise<ActionResponse> {
  if (!payload.customer_name || !payload.principal_amount) {
    return { ok: false, mode: "preview", action: "debt.create", error: "ต้องระบุ customer_name และ principal_amount" };
  }

  return {
    ok: true,
    mode: "preview",
    action: "debt.create",
    preview: {
      customer_name: payload.customer_name,
      principal_amount: payload.principal_amount,
      fee_rate: payload.fee_rate ?? 5.0,
      interest_start_at: payload.interest_start_at ?? new Date().toISOString(),
      will_create: {
        table: "debt_trackings",
        source: "deadboard",
      },
    },
  };
}

export async function executeDebtCreate(payload: {
  customer_name: string;
  principal_amount: number;
  fee_rate?: number;
  interest_start_at?: string;
}): Promise<ActionResponse> {
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

  if (error) {
    return { ok: false, mode: "execute", action: "debt.create", error: error.message };
  }

  return {
    ok: true,
    mode: "execute",
    action: "debt.create",
    result: { id: data.id, customer_name: data.customer_name, principal_amount: data.principal_amount },
  };
}

// ---- DISPATCH ----

export async function dispatchAction(req: ActionRequest): Promise<ActionResponse> {
  const { action, mode, payload } = req;

  switch (action) {
    case "payment":
      return mode === "preview"
        ? previewPayment(payload.invoice_debt_id as string)
        : executePayment(payload as Parameters<typeof executePayment>[0]);

    case "document.create":
      return mode === "preview"
        ? previewDocumentCreate(payload)
        : executeDocumentCreate(payload as Parameters<typeof executeDocumentCreate>[0]);

    case "debt.create":
      return mode === "preview"
        ? previewDebtCreate(payload)
        : executeDebtCreate(payload as Parameters<typeof executeDebtCreate>[0]);

    default:
      return { ok: false, mode, action, error: `ไม่รู้จัก action: ${action}` };
  }
}
