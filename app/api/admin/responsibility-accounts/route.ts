import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"

const ACCOUNT_KINDS = ["mailbox", "provider_account", "platform_account", "service_account"] as const
const OWNER_KINDS = ["platform", "user", "organization", "company"] as const

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabaseAdmin()
  const systemDb = db.schema("system")
  const [accountsResult, usersResult, organizationsResult, companiesResult] = await Promise.all([
    systemDb.from("responsibility_accounts").select("*").order("provider_code").order("provider_account_ref"),
    db.from("profiles").select("id, email, role").order("email"),
    db.from("organizations").select("id, name").order("name"),
    db.from("companies").select("id, name").order("name"),
  ])

  if (accountsResult.error) {
    return NextResponse.json({ ok: false, error: accountsResult.error.message, code: "REGISTRY_NOT_READY" }, { status: 503 })
  }
  if (usersResult.error || organizationsResult.error || companiesResult.error) {
    const error = usersResult.error ?? organizationsResult.error ?? companiesResult.error
    return NextResponse.json({ ok: false, error: error?.message ?? "อ่านบัญชีเจ้าของไม่สำเร็จ" }, { status: 500 })
  }

  return NextResponse.json({
    accounts: accountsResult.data ?? [],
    owners: {
      users: usersResult.data ?? [],
      organizations: organizationsResult.data ?? [],
      companies: companiesResult.data ?? [],
    },
  })
}

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "ข้อมูลบัญชีไม่ถูกต้อง" }, { status: 400 })
  }
  const providerCode = typeof body.provider_code === "string" ? body.provider_code.trim().toLowerCase() : ""
  const accountKind = typeof body.account_kind === "string" ? body.account_kind : ""
  const accountRef = typeof body.provider_account_ref === "string" ? body.provider_account_ref.trim() : ""
  if (!providerCode || providerCode.length > 80 || !accountRef || accountRef.length > 255
      || !ACCOUNT_KINDS.includes(accountKind as typeof ACCOUNT_KINDS[number])) {
    return NextResponse.json({ ok: false, error: "ต้องระบุ provider, ประเภทบัญชี และรหัสบัญชีที่ไม่ใช่ secret" }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin().schema("system").from("responsibility_accounts").insert({
    provider_code: providerCode,
    account_kind: accountKind,
    provider_account_ref: accountRef,
    display_name: typeof body.display_name === "string" ? body.display_name.trim().slice(0, 160) : null,
    email_address: typeof body.email_address === "string" ? body.email_address.trim().toLowerCase().slice(0, 255) : null,
    source_connector_id: typeof body.source_connector_id === "string" ? body.source_connector_id : null,
    owner_kind: "unassigned",
    attribution_status: "unverified",
  }).select("*").single()
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.code === "23505" ? 409 : 500 })
  }
  return NextResponse.json({ ok: true, account: data }, { status: 201 })
}

export async function PATCH(request: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => null)
  const ownerKind = typeof body?.owner_kind === "string" ? body.owner_kind : ""
  if (!body || typeof body.id !== "string" || !OWNER_KINDS.includes(ownerKind as typeof OWNER_KINDS[number])) {
    return NextResponse.json({ ok: false, error: "ข้อมูลผู้รับผิดชอบไม่ถูกต้อง" }, { status: 400 })
  }
  if (ownerKind === "platform" && auth.role !== "super_admin") {
    return NextResponse.json({ ok: false, error: "การกำหนดบัญชีแพลตฟอร์มต้องใช้ super admin" }, { status: 403 })
  }
  const ownerUserId = ownerKind === "user" && typeof body.owner_id === "string" ? body.owner_id : null
  const ownerOrganizationId = ownerKind === "organization" && typeof body.owner_id === "string"
    ? body.owner_id
    : ownerKind === "company" && typeof body.owner_organization_id === "string" ? body.owner_organization_id : null
  const ownerCompanyId = ownerKind === "company" && typeof body.owner_id === "string" ? body.owner_id : null
  if (["user", "organization", "company"].includes(ownerKind) && !body.owner_id) {
    return NextResponse.json({ ok: false, error: "ต้องเลือกเจ้าของที่ตรงกับขอบเขต" }, { status: 400 })
  }
  if (typeof body.verification_reference !== "string" || body.verification_reference.trim().length < 3) {
    return NextResponse.json({ ok: false, error: "ต้องใส่แหล่งหลักฐานการยืนยันเจ้าของ" }, { status: 400 })
  }

  const { error } = await supabaseAdmin().schema("system").rpc("assign_responsibility_account_owner", {
    p_responsibility_account_id: body.id,
    p_owner_kind: ownerKind,
    p_owner_user_id: ownerUserId,
    p_owner_organization_id: ownerOrganizationId,
    p_owner_company_id: ownerCompanyId,
    p_actor_user_id: auth.id,
    p_verification_reference: body.verification_reference.trim(),
  })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
