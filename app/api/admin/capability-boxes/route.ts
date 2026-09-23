/**
 * GET /api/admin/capability-boxes
 *
 * Box Catalog Read Layer (เส้นนอก Canvas — รอบนี้ไม่แตะ Canvas ที่ FROZEN)
 * Read-only · ไม่มี live call · ไม่มีค่าใช้จ่าย · ไม่อ่าน DB
 *
 * Auth: requireAuth(ADMIN_TIER) — pattern เดียวกับ /api/admin/connectors/catalog
 * ข้อมูลทั้งหมดอ่านจาก registry + composition ที่มีอยู่จริง (ดู _lib/boxCatalog.ts)
 * ไม่สร้าง registry ใหม่ · ไม่สร้าง resolver ใหม่ · ไม่แก้ capability ใด
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { buildCapabilityBoxCatalog } from "./_lib/boxCatalog";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const catalog = buildCapabilityBoxCatalog();
  return NextResponse.json({ ok: true, catalog });
}
