import { NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"

// Cost/infrastructure dashboard (owner, 2026-08-03): "หน้าจอค่าใช้จ่าย...
// ขึ้นมาแสดงผลในค่าใช้จ่ายและตัวประมวลผลต่างๆ". registry/infrastructure.json
// already tracked every real external service + cost — this just serves it
// to the admin UI (Rule 103: reuse before build, no new data source).
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const filePath = path.join(process.cwd(), "registry", "infrastructure.json")
  const raw = await readFile(filePath, "utf-8")
  return NextResponse.json(JSON.parse(raw))
}
