import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER, getAccessToken } from "@/core/auth/session"
import { loadCompanySettings, saveCompanySettings } from "@/core/config/company-settings"

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  try {
    const settings = await loadCompanySettings()
    return NextResponse.json({ settings })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const token = await getAccessToken()
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  try {
    await saveCompanySettings(token, {
      companyName: String(body.companyName ?? "").trim(),
      companyTaxId: String(body.companyTaxId ?? "").trim(),
      paymentBankName: String(body.paymentBankName ?? "").trim(),
      paymentAccountNumber: String(body.paymentAccountNumber ?? "").trim(),
      paymentAccountName: String(body.paymentAccountName ?? "").trim(),
    })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" }, { status: 500 })
  }
}