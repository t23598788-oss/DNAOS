/**
 * GET /api/public/products — public, read-only, no login.
 *
 * Publication permission is checked in the reader (core/public-catalog), NOT
 * here: this route never decides what is public, it only formats the answer.
 * DEFAULT DENY — a record without a live `publication_records` row is invisible.
 *
 * Query: ?type=material|transport|equipment &q= &province= &district= &area=
 *        &page= &pageSize=
 * Cache: 60s (short on purpose — a published price change must be visible
 * within a minute, per the mission's cache requirement).
 *
 * Every item in the response has already passed through
 * core/public-catalog/policy.toPublicView — no source record ids, no verifier
 * email, no organisation owner, no raw address. Internal identifiers stay on
 * the server.
 */
import { NextRequest, NextResponse } from "next/server"
import { readPublicCatalog, allowRequest, PUBLIC_CACHE_SECONDS } from "@/services/public-catalog/reader"
import type { CatalogType } from "@/core/public-catalog/policy"

const VALID_TYPES: CatalogType[] = ["material", "transport", "equipment"]

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? ""
  return forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"
}

function headers() {
  return {
    "Access-Control-Allow-Origin": "*",
    // No stale-while-revalidate: a price answer served while the CDN revalidates
    // is still a stale price. Upper bound is now the TTL itself (60s), which is
    // what the reader memo uses — one number for every layer, changed only here.
    "Cache-Control": `public, s-maxage=${PUBLIC_CACHE_SECONDS}`,
  }
}

export async function GET(req: NextRequest) {
  if (!allowRequest(`products:${clientKey(req)}`)) {
    return NextResponse.json(
      { ok: false, error: "คำขอถี่เกินกำหนด กรุณาลองใหม่ภายหลัง" },
      { status: 429, headers: { ...headers(), "Retry-After": "60" } },
    )
  }

  const sp = req.nextUrl.searchParams
  const rawType = sp.get("type")?.trim().toLowerCase() ?? ""
  if (rawType && !VALID_TYPES.includes(rawType as CatalogType)) {
    return NextResponse.json(
      { ok: false, error: `type ต้องเป็นหนึ่งใน: ${VALID_TYPES.join(", ")}` },
      { status: 400, headers: headers() },
    )
  }

  try {
    const result = await readPublicCatalog({
      type: (rawType || undefined) as CatalogType | undefined,
      q: sp.get("q") ?? undefined,
      area: sp.get("area") ?? undefined,
      province: sp.get("province") ?? undefined,
      district: sp.get("district") ?? undefined,
      page: Number(sp.get("page") ?? "1"),
      pageSize: Number(sp.get("pageSize") ?? ""),
    })

    return NextResponse.json(
      {
        ok: true,
        generated_at: result.generated_at,
        page: result.page,
        page_size: result.pageSize,
        total: result.total,
        // explicit empty state — never a fabricated placeholder listing
        empty_reason: result.empty_reason,
        // filter options derived from the published set only
        facets: result.facets,
        items: result.items,
      },
      { headers: headers() },
    )
  } catch (err) {
    // Fail closed: no partial/fabricated catalog if the source is unreachable.
    return NextResponse.json(
      {
        ok: false,
        error: "แคตตาล็อกสาธารณะยังไม่พร้อมใช้งาน (แหล่งข้อมูลหรือสิทธิ์เผยแพร่ยังไม่พร้อม)",
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
