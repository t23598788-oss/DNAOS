/**
 * RESOURCE SELF-SERVICE (/api/public/resources) — owner directive 2026-10-15
 *
 * PHASE 3 + 6: ผู้ลงทะเบียนจัดการทรัพยากรของตัวเองผ่านตารางเดิมทั้งหมด
 *   · GET  action=mine    → ทรัพยากรของฉัน (ต้อง login — ownership ที่อยู่ใน query)
 *   · GET  action=public  → ทะเบียนสาธารณะ (ไม่ต้อง login — เฉพาะ PUBLIC fields)
 *   · POST                → create_my_site / update_my_site / add_material /
 *                           update_price / add_demand — ทุกจุดผ่าน Ownership gate
 *                           (pit_profiles.user_id === caller — ไม่ตรง = 403 fail-closed)
 *
 * ห้ามแก้ข้อมูลของบุคคลอื่น — ตรวจสิทธิ์ทุกครั้งใน engines/public-registry/service.ts
 * PUBLIC/PRIVATE: เส้น public คืนเฉพาะ pit_name/address/พิกัด/วัสดุ+ราคา — ไม่มี
 * user_id/tax_id/bank หลุด (PRIVATE อยู่ในเส้น mine เท่านั้น) · RLS เดิม
 * (service_role_only) ยังกันด่าน DB ตามเดิม — ไม่เปิดนอกเส้นนี้
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ANY_AUTHENTICATED } from "@/core/auth/session";
import {
  addMyDemandRequest, addMyMaterialListing, createMyResourceSite,
  getMyInventory, listMyResources, listPublicRegistry, recordMyStockMovement,
  updateMyMaterialPrice, updateMyResourceSite,
} from "@/engines/public-registry/service";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") ?? "public";
  if (action === "public") {
    const result = await listPublicRegistry(searchParams.get("keyword") ?? undefined, searchParams.get("material_type_id") ?? undefined);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }
  // mine — ต้อง login (ทุก role ที่มีจริง ใช้ขอเดิม)
  const auth = await requireAuth(ANY_AUTHENTICATED);
  if (auth instanceof NextResponse) return auth;
  // WORKSTREAM 1 — inventory (สต็อกของฉันแยกจานตามโกดัง + ประวัติเคลื่อนไหว)
  if (action === "inventory") {
    const result = await getMyInventory(auth.id);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }
  const result = await listMyResources(auth.id);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function POST(req: Request) {
  const auth = await requireAuth(ANY_AUTHENTICATED);
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => null)) as {
    action?: string; pit_id?: string; pit_name?: string; phone?: string; address?: string;
    latitude?: number; longitude?: number; is_open?: boolean;
    material_type_id?: string; price?: number | null; requested_quantity?: number | null;
    direction?: string; quantity?: number | null; unit?: string;
  } | null;
  const action = body?.action ?? "";
  const r = await (async (): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> => {
    switch (action) {
      case "create_my_site":
        return createMyResourceSite(auth.id, {
          pit_name: String(body?.pit_name ?? ""), phone: body?.phone, address: body?.address,
          latitude: Number(body?.latitude), longitude: Number(body?.longitude), is_open: body?.is_open,
        });
      case "update_my_site":
        if (!body?.pit_id) return { ok: false, error: "ต้องระบุ pit_id" };
        return updateMyResourceSite(auth.id, body.pit_id, {
          pit_name: body.pit_name, phone: body.phone, address: body.address,
          latitude: body.latitude, longitude: body.longitude, is_open: body.is_open,
        });
      case "add_material":
        if (!body?.pit_id || !body?.material_type_id) return { ok: false, error: "ต้องระบุ pit_id + material_type_id" };
        return addMyMaterialListing(auth.id, { pit_id: body.pit_id, material_type_id: body.material_type_id, price: body.price ?? null });
      case "update_price":
        if (!body?.pit_id || !body?.material_type_id || body?.price == null) return { ok: false, error: "ต้องระบุ pit_id + material_type_id + price" };
        return updateMyMaterialPrice(auth.id, { pit_id: body.pit_id, material_type_id: body.material_type_id, price: body.price });
      case "add_demand":
        if (!body?.pit_id || !body?.material_type_id) return { ok: false, error: "ต้องระบุ pit_id + material_type_id" };
        return addMyDemandRequest(auth.id, { pit_id: body.pit_id, material_type_id: body.material_type_id, requested_quantity: body.requested_quantity ?? null });
      case "record_stock_movement": {
        // WORKSTREAM 1 — รับเข้า/จ่ายออก/จอง/คืนจอง ผ่าน canonical writer เส้นเดียว
        const dirs = ["in", "out", "reserve", "release"] as const;
        if (!body?.pit_id || !body?.material_type_id) return { ok: false, error: "ต้องระบุ pit_id + material_type_id" };
        if (!body?.unit?.trim()) return { ok: false, error: "ต้องระบุหน่วยนับที่มีหลักฐาน (unit)" };
        if (!(dirs as readonly string[]).includes(String(body?.direction?.trim()))) return { ok: false, error: "direction ต้องเป็น in|out|reserve|release" };
        try {
          return await recordMyStockMovement(auth.id, {
            pit_id: body.pit_id, material_type_id: body.material_type_id,
            direction: body.direction as (typeof dirs)[number],
            quantity: Number(body.quantity), unit: String(body.unit ?? "").trim(), evidence_note: null,
          });
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "invalid movement" };
        }
      }
      default:
        return { ok: false, error: `action ไม่รู้จัก: ${action || "(empty)"}` };
    }
  })();
  return NextResponse.json(r, { status: r.ok ? 200 : r.error?.startsWith("FORBIDDEN") ? 403 : r.error?.startsWith("NOT_FOUND") ? 404 : 400 });
}
