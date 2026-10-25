/**
 * GET /api/public/products/:slug — public detail, read-only, no login.
 * Same publication gate as the list route (core/public-catalog/reader).
 * 404 (not 403) for draft/expired/withdrawn/unknown slugs so the endpoint never
 * reveals whether a non-public record exists.
 */
import { NextRequest, NextResponse } from "next/server"
import { readPublicItem, allowRequest, PUBLIC_CACHE_SECONDS } from "@/services/public-catalog/reader"

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? ""
  return forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"
}

function headers() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": `public, s-maxage=${PUBLIC_CACHE_SECONDS}, stale-while-revalidate=300`,
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!allowRequest(`product:${clientKey(req)}`)) {
    return NextResponse.json(
      { ok: false, error: "คำขอถี่เกินกำหนด กรุณาลองใหม่ภายหลัง" },
      { status: 429, headers: { ...headers(), "Retry-After": "60" } },
    )
  }

  const { slug } = await params

  try {
    const item = await readPublicItem(slug)
    if (!item) {
      return NextResponse.json({ ok: false, error: "ไม่พบรายการนี้" }, { status: 404, headers: headers() })
    }
    return NextResponse.json({ ok: true, item }, { headers: headers() })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "แคตตาล็อกสาธารณะยังไม่พร้อมใช้งาน",
        detail: err instanceof Error ? err.message.slice(0, 160) : "unknown",
      },
      { status: 503, headers: { ...headers(), "Cache-Control": "no-store" } },
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
