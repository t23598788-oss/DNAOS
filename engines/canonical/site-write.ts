import { supabaseAdmin } from "@/services/supabase/queries"

export interface CreateCustomerSiteInput {
  customer_company_id: string
  site_name?: string | null
  address?: string | null
  province?: string | null
  district?: string | null
  subdistrict?: string | null
  postal_code?: string | null
  gps_lat?: number | null
  gps_lng?: number | null
  is_active?: boolean
  updated_at?: string | null
}

export interface CreateCustomerSiteResult {
  site_id: string
}

export async function createCustomerSite(input: CreateCustomerSiteInput): Promise<CreateCustomerSiteResult> {
  const db = supabaseAdmin()
  const row: Record<string, unknown> = {
    customer_company_id: input.customer_company_id,
  }
  const optional: (keyof CreateCustomerSiteInput)[] = [
    "site_name",
    "address",
    "province",
    "district",
    "subdistrict",
    "postal_code",
    "gps_lat",
    "gps_lng",
    "is_active",
    "updated_at",
  ]
  for (const key of optional) {
    if (input[key] !== undefined) row[key] = input[key]
  }
  const { data, error } = await db.from("customer_sites").insert(row).select("id").single()
  if (error || !data) throw new Error(`สร้าง customer_site ไม่สำเร็จ: ${error?.message ?? "no row"}`)
  return { site_id: String(data.id) }
}
