import { NextResponse } from "next/server"
import { createCustomerSite } from "@/engines/canonical/site-write"

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null)

export async function POST(req: Request) {
  const secret = process.env.CONNECT_INTERNAL_SECRET
  if (!secret) return NextResponse.json({ ok: false, error: "CONNECT_INTERNAL_SECRET not configured" }, { status: 503 })
  if (req.headers.get("x-connect-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "ไม่ได้รับอนุญาต" }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: "unparseable JSON body" }, { status: 400 })
  }

  const customerCompanyId = str(body.customer_company_id)
  if (!customerCompanyId) {
    return NextResponse.json({ ok: false, error: "customer_company_id is required" }, { status: 400 })
  }

  try {
    const result = await createCustomerSite({
      customer_company_id: customerCompanyId,
      site_name: str(body.site_name),
      address: str(body.address),
      province: str(body.province),
      district: str(body.district),
      subdistrict: str(body.subdistrict),
      postal_code: str(body.postal_code),
      gps_lat: numOrNull(body.gps_lat),
      gps_lng: numOrNull(body.gps_lng),
      is_active: boolOrNull(body.is_active) ?? true,
      updated_at: str(body.updated_at),
    })
    return NextResponse.json({ ok: true, data: result })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "สร้าง customer_site ไม่สำเร็จ"
    return NextResponse.json({ ok: false, error: message }, { status: 422 })
  }
}
