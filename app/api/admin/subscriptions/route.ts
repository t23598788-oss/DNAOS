import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"

// Gmail subscription observer. Rows are detections from the configured
// mailbox; the table does not prove payer or organization ownership and is not
// a business expense ledger.
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabaseAdmin()
  const { data: legacyRows, error: legacyError } = await db
    .from("subscription_services")
    .select("*")
    .order("amount", { ascending: false, nullsFirst: false })
  if (legacyError) return NextResponse.json({ error: legacyError.message }, { status: 500 })

  // The local responsibility registry may not have been applied yet. Keep
  // the existing observer usable, but state that ownership evidence is absent.
  const systemDb = db.schema("system")
  const { data: costs, error: registryError } = await systemDb
    .from("subscription_costs")
    .select("*")
    .order("updated_at", { ascending: false })

  if (registryError) {
    return NextResponse.json({
      services: (legacyRows ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        responsibility_id: null,
        payer_attribution_status: "unassigned",
        payer_account: null,
        source_account: null,
      })),
      responsibility_registry: "not_applied",
    })
  }

  const legacyById = new Map((legacyRows ?? []).map((row: Record<string, unknown>) => [String(row.id), row]))
  const { data: accounts, error: accountsError } = await systemDb
    .from("responsibility_accounts")
    .select("id, provider_code, account_kind, provider_account_ref, display_name, email_address, owner_kind, owner_user_id, owner_organization_id, owner_company_id, attribution_status")
  if (accountsError) return NextResponse.json({ error: accountsError.message }, { status: 500 })
  const accountsById = new Map((accounts ?? []).map((account: Record<string, unknown>) => [String(account.id), account]))

  const mapped: Record<string, unknown>[] = (costs ?? []).map((cost: Record<string, unknown>) => {
    const legacy = cost.legacy_subscription_service_id
      ? legacyById.get(String(cost.legacy_subscription_service_id))
      : undefined
    return {
      ...(legacy ?? {}),
      id: legacy?.id ?? cost.id,
      responsibility_id: cost.id,
      provider: cost.provider_code,
      service_name: cost.service_name,
      amount: cost.amount,
      currency: cost.currency,
      billing_cycle: cost.billing_cycle,
      status: cost.service_status,
      payer_attribution_status: cost.payer_attribution_status,
      payer_account: cost.payer_account_id ? accountsById.get(String(cost.payer_account_id)) ?? null : null,
      source_account: cost.source_account_id ? accountsById.get(String(cost.source_account_id)) ?? null : null,
      evidence_reference: cost.last_source_event_ref,
    }
  })

  const mappedLegacyIds = new Set((costs ?? [])
    .map((cost: Record<string, unknown>) => String(cost.legacy_subscription_service_id ?? ""))
    .filter(Boolean))
  for (const row of legacyRows ?? []) {
    if (!mappedLegacyIds.has(String((row as Record<string, unknown>).id))) {
      mapped.push({
        ...(row as Record<string, unknown>),
        responsibility_id: null,
        payer_attribution_status: "unassigned",
        payer_account: null,
        source_account: null,
      })
    }
  }

  return NextResponse.json({ services: mapped, responsibility_registry: "ready" })
}

export async function PATCH(request: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => null)
  if (!body || typeof body.responsibility_id !== "string") {
    return NextResponse.json({ ok: false, error: "ต้องระบุรายการ subscription ในทะเบียนกลาง" }, { status: 400 })
  }
  const payerAccountId = body.payer_account_id === null ? null
    : typeof body.payer_account_id === "string" ? body.payer_account_id : undefined
  const sourceAccountId = body.source_account_id === null ? null
    : typeof body.source_account_id === "string" ? body.source_account_id : undefined
  if (payerAccountId === undefined || sourceAccountId === undefined
      || typeof body.verification_reference !== "string" || body.verification_reference.trim().length < 3) {
    return NextResponse.json({ ok: false, error: "ต้องเลือกบัญชีผู้จ่าย/บัญชีอีเมล และระบุหลักฐาน" }, { status: 400 })
  }

  const { error } = await supabaseAdmin().schema("system").rpc("assign_subscription_cost_accounts", {
    p_subscription_cost_id: body.responsibility_id,
    p_payer_account_id: payerAccountId,
    p_source_account_id: sourceAccountId,
    p_actor_user_id: auth.id,
    p_verification_reference: body.verification_reference.trim(),
  })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => null)
  if (!body || typeof body.provider_code !== "string" || typeof body.service_name !== "string"
      || typeof body.cost_kind !== "string" || typeof body.source_kind !== "string"
      || typeof body.source_reference !== "string") {
    return NextResponse.json({ ok: false, error: "ข้อมูลค่าบริการหรือหลักฐานไม่ครบ" }, { status: 400 })
  }
  const amount = body.amount === "" || body.amount === null || body.amount === undefined ? null : Number(body.amount)
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    return NextResponse.json({ ok: false, error: "จำนวนเงินไม่ถูกต้อง" }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin().schema("system").rpc("register_subscription_cost", {
    p_provider_code: body.provider_code.trim(),
    p_service_name: body.service_name.trim(),
    p_cost_kind: body.cost_kind,
    p_amount: amount,
    p_currency: typeof body.currency === "string" ? body.currency.trim() : "THB",
    p_billing_cycle: typeof body.billing_cycle === "string" && body.billing_cycle ? body.billing_cycle : null,
    p_source_kind: body.source_kind,
    p_source_reference: body.source_reference.trim(),
    p_actor_user_id: auth.id,
  })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, subscription_cost_id: data }, { status: 201 })
}
