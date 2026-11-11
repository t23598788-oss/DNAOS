import { supabaseAdmin } from "@/services/supabase/queries"

export interface CreatePendingAuthorizationInput {
  company_id: string
  claimant_line_user_id: string
  claimant_description: string | null
  request_description: string
  responsible_line_user_id: string
  business_event_id: string | null
  status: string
}

export interface ResolvedPendingAuthorization {
  id: string
  claimant_line_user_id: string | null
  request_description: string | null
}

export async function createPendingAuthorization(input: CreatePendingAuthorizationInput): Promise<{ id: string }> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from("pending_authorizations")
    .insert({
      company_id: input.company_id,
      claimant_line_user_id: input.claimant_line_user_id,
      claimant_description: input.claimant_description,
      request_description: input.request_description,
      responsible_line_user_id: input.responsible_line_user_id,
      business_event_id: input.business_event_id,
      status: input.status,
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`สร้าง pending_authorization ไม่สำเร็จ: ${error?.message ?? "no row"}`)
  return { id: String(data.id) }
}

export async function resolvePendingAuthorization(
  id: string,
  status: string,
): Promise<ResolvedPendingAuthorization | null> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from("pending_authorizations")
    .update({ status, resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("claimant_line_user_id, request_description")
    .maybeSingle()
  if (error) throw new Error(`อัปเดต pending_authorization ไม่สำเร็จ: ${error.message}`)
  if (!data) return null
  return {
    id,
    claimant_line_user_id: data.claimant_line_user_id ?? null,
    request_description: data.request_description ?? null,
  }
}
