import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { dispatch } from "@/engines/validation/dispatcher"

// ACTIVATE — Material Calculation บน /biz (2026-10-13)
// เปิดให้ Business Workspace เรียก `material.quote` (engine เดิมใน engines/validation/dispatcher)
// ผ่าน transport บาง ๆ นี้ — ไม่สร้าง pricing engine คู่ขนาน, ไม่แตะ LINE path เดิม
// `material.quote` คำนวณอย่างเดียว (resolveMaterial + GPS + pricing + capacity + cost) ไม่เขียน DB
// จึงปลอดภัยใน READ transport — เหมือน /api/v1/mcp/business/dispatch ที่เป็น readonly dispatch
export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const rawInput = typeof body?.raw_input === "string" ? body.raw_input.trim() : ""
  const quantity = Number(body?.quantity ?? 0)
  const customerId = typeof body?.customer_id === "string" ? body.customer_id : ""

  if (!rawInput || !Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ ok: false, error: "ต้องระบุ raw_input และ quantity (>0)" }, { status: 400 })
  }

  const result = await dispatch("material.quote", { raw_input: rawInput, quantity, customer_id: customerId })
  return NextResponse.json({ ok: result.ok, command: result.command, data: result.data, violations: result.violations })
}
