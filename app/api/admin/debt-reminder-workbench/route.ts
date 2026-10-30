import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, isCompanyVisible, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"
import { loadCompanySettings } from "@/core/config/company-settings"
import { isDebtPreviewMode } from "@/engines/debt/preview-mode"
import {
  buildDebtReminderWorkbench,
  previewDebtReminder,
} from "@/engines/debt/workbench"

// Debt Collection Workbench (M026) — the staging screen's data source.
//
// Reads the canonical debt authorities through one service; writes nothing
// except `preview` audit rows, and only when SAFE PREVIEW MODE is on. The real
// LINE send path is not reachable from this route at all.

async function context() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return { auth, denied: auth }
  const scope = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(scope)
  if (denied) return { auth, denied }
  return { auth, scope }
}

async function labelling() {
  const db = supabase()
  const { data: rows } = await db
    .from("app_configs")
    .select("title, data")
    .in("title", ["debt-reminder-contact-channel"])
  const config = Object.fromEntries((rows ?? []).map((r) => [r.title, r.data]))
  const settings = await loadCompanySettings().catch(() => null)
  return {
    creditorName: settings?.companyName || "DNA OS",
    contactChannel: config["debt-reminder-contact-channel"] || "LINE OA ของบริษัท",
  }
}

export async function GET(req: NextRequest) {
  const { denied, scope } = await context()
  if (denied || !scope) return denied!

  const filterCompanyId = req.nextUrl.searchParams.get("companyId")
  if (filterCompanyId && !isCompanyVisible(scope, filterCompanyId)) {
    return NextResponse.json({ error: "ไม่พบข้อมูล" }, { status: 404 })
  }

  try {
    const labels = await labelling()
    const workbench = await buildDebtReminderWorkbench(supabase(), {
      companyIds: scope.companyIds,
      filterCompanyId,
      creditorName: labels.creditorName,
      contactChannel: labels.contactChannel,
      previewMode: isDebtPreviewMode(process.env),
    })
    return NextResponse.json(workbench)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const { auth, denied, scope } = await context()
  if (denied || !scope) return denied!

  if (!isDebtPreviewMode(process.env)) {
    return NextResponse.json(
      {
        error: "โหมดนี้ใช้ได้เฉพาะ SAFE PREVIEW MODE (DEBT_REMINDER_PREVIEW_MODE=1)",
        reason: "PREVIEW_MODE_INACTIVE",
      },
      { status: 409 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const companyId = typeof body?.companyId === "string" ? body.companyId : ""
  const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId : ""
  const state = body?.state
  if (!companyId || !invoiceId || !["BEFORE_DUE", "DUE_TODAY", "OVERDUE"].includes(state)) {
    return NextResponse.json({ error: "ต้องระบุ companyId, invoiceId และ state ที่ถูกต้อง" }, { status: 400 })
  }
  if (!isCompanyVisible(scope, companyId)) {
    return NextResponse.json({ error: "ไม่พบข้อมูล" }, { status: 404 })
  }

  try {
    const labels = await labelling()
    const result = await previewDebtReminder(supabase(), {
      companyId,
      invoiceId,
      state,
      creditorName: labels.creditorName,
      contactChannel: labels.contactChannel,
      actor: auth?.email ?? auth?.id ?? "admin",
    })
    return NextResponse.json(result)
  } catch (e) {
    const code = (e as { code?: string }).code
    const statusMap: Record<string, number> = {
      INVOICE_NOT_FOUND: 404,
      NO_OUTSTANDING: 409,
      RECIPIENT_BLOCKED: 409,
      COMPOSE_REJECTED: 409,
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), code: code ?? "PREVIEW_FAILED" },
      { status: code ? (statusMap[code] ?? 500) : 500 },
    )
  }
}
