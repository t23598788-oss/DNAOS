import { supabaseAdmin } from "@/services/supabase/queries"

export async function markSupabaseBillingEventPaid(partnerPayableRequestId: string): Promise<void> {
  const db = supabaseAdmin()
  const { error } = await db
    .from("supabase_billing_events")
    .update({ status: "paid" })
    .eq("partner_payable_request_id", partnerPayableRequestId)
  if (error) throw new Error(`อัปเดต supabase_billing_event ไม่สำเร็จ: ${error.message}`)
}
