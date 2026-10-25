/**
 * ASSET OWNERSHIP SELF-SERVICE (/api/public/assets) — owner directive 2026-10-15
 *
 * WORKSTREAM 2: ผู้ลงทะเบียนจัดการได้เฉพาะทรัพย์ที่ตนมีสิทธิ์:
 *   · GET  → ทรัพย์ของฉัน (ตารางเดิม equipment_assets + ความสัมพันธ์เจ้าของ 20261016000002)
 *   · POST register_my_asset  → ลงทะเบียนรถ/เครื่องจักร (กันซ้ำ asset_code · company ต้อง
 *     ผ่านความสัมพันธ์ที่ตรวจสิทธิ์ได้จริง company_members — W3)
 *   · POST update_my_asset    → แก้ชื่อ/สมรรถนะ/สถานะพร้อมรับงาน — เจ้าของเท่านั้น
 * ไม่สร้างระบบรถ/เครื่องจักรซ้ำ — อ่าน/เขียนตารางเดิมเสมอ · auth เดิมจริง
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ANY_AUTHENTICATED } from "@/core/auth/session";
import { listMyAssets, registerMyAsset, updateMyAsset } from "@/engines/public-registry/service";

export async function GET() {
  const auth = await requireAuth(ANY_AUTHENTICATED);
  if (auth instanceof NextResponse) return auth;
  const result = await listMyAssets(auth.id);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function POST(req: Request) {
  const auth = await requireAuth(ANY_AUTHENTICATED);
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => null)) as {
    action?: string; asset_id?: string; asset_code?: string; name?: string;
    company_id?: string | null; capacity_value?: number | null; capacity_unit?: string | null;
    available_for_dispatch?: boolean;
  } | null;
  const action = body?.action ?? "";
  if (action === "register_my_asset") {
    const r = await registerMyAsset(auth.id, {
      asset_code: String(body?.asset_code ?? ""), name: String(body?.name ?? ""),
      company_id: body?.company_id ?? null,
      capacity_value: body?.capacity_value ?? null, capacity_unit: body?.capacity_unit ?? null,
      available_for_dispatch: body?.available_for_dispatch ?? false,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : r.error?.startsWith("FORBIDDEN") ? 403 : 400 });
  }
  if (action === "update_my_asset") {
    if (!body?.asset_id) return NextResponse.json({ ok: false, error: "ต้องระบุ asset_id" }, { status: 400 });
    const r = await updateMyAsset(auth.id, body.asset_id, {
      name: body.name, capacity_value: body.capacity_value,
      capacity_unit: body.capacity_unit, available_for_dispatch: body.available_for_dispatch,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : r.error?.startsWith("FORBIDDEN") ? 403 : 400 });
  }
  return NextResponse.json({ ok: false, error: `action ไม่รู้จัก: ${action || "(empty)"}` }, { status: 400 });
}
