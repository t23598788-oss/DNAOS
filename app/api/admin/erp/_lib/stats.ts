import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import type { ErpBrainStats } from "@/engines/erp/brain"

// สถิติจริงจากตารางใหม่ (products, business_profiles, media_showcases, catalogs)
// ใช้ service role ผ่าน API route เท่านั้น — client อ่านโดยตรงไม่ได้ (RLS เปิดอยู่)
export async function fetchProductCatalogStats(
  db: ReturnType<typeof supabase>,
): Promise<ErpBrainStats> {
  const [bp, catalogs, products, media] = await Promise.all([
    db.from("business_profiles").select("id", { count: "exact", head: true }),
    db.from("catalogs").select("id", { count: "exact", head: true }),
    db.from("products").select("status, price"),
    db.from("media_showcases").select("id", { count: "exact", head: true }),
  ])
  const rows = (products.data ?? []) as { status: string | null; price: number | string | null }[]
  let available = 0
  let outOfStock = 0
  let custom = 0
  let priceSum = 0
  let priceN = 0
  let priceMin: number | null = null
  let priceMax: number | null = null
  for (const r of rows) {
    if (r.status === "AVAILABLE") available++
    else if (r.status === "OUT_OF_STOCK") outOfStock++
    else if (r.status === "CUSTOM_ORDER") custom++
    const p = typeof r.price === "string" ? Number(r.price) : r.price
    if (typeof p === "number" && Number.isFinite(p)) {
      priceSum += p
      priceN++
      if (priceMin === null || p < priceMin) priceMin = p
      if (priceMax === null || p > priceMax) priceMax = p
    }
  }
  return {
    product_catalog: {
      business_profiles: bp.count ?? 0,
      catalogs: catalogs.count ?? 0,
      products_total: rows.length,
      products_available: available,
      products_out_of_stock: outOfStock,
      products_custom_order: custom,
      media_showcases: media.count ?? 0,
      price_min: priceMin,
      price_max: priceMax,
      price_avg: priceN > 0 ? Math.round((priceSum / priceN) * 100) / 100 : null,
    },
  }
}
