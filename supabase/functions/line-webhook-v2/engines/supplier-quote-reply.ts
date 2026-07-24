// Outbound Supplier RFQ — reply parser (owner, 2026-07-24, Autonomous Supply
// Chain Orchestrator Step 3). The send side (app/api/admin/pits/[pitId]/
// request-quote/route.ts) creates a pending pit_price_requests row and
// pushes a real LINE text asking for a price; this is the matching read
// side — the ONLY place a supplier's reply becomes a real pit_materials
// price update. Narrow, specific match only (same "if no clear signal,
// return null and let the caller fall through" pattern as payment-claim.ts/
// payment-instructions.ts) — never touches a message unless the sender is a
// KNOWN pit's line_user_id AND there's a real pending request waiting.

const PRICE_PATTERN = /(\d+(?:[.,]\d+)?)/

export function extractPrice(text: string): number | null {
  const match = text.match(PRICE_PATTERN)
  if (!match) return null
  const value = Number(match[1].replace(/,/g, ""))
  return Number.isFinite(value) && value > 0 ? value : null
}

export async function trySupplierQuoteReply(
  supabase: any,
  lineUserId: string,
  text: string,
): Promise<string | null> {
  const { data: pit } = await supabase
    .from("pit_profiles")
    .select("id, pit_name")
    .eq("line_user_id", lineUserId)
    .is("deleted_at", null)
    .maybeSingle()
  if (!pit) return null // not a known supplier — let the customer-side chain handle this message

  const { data: request } = await supabase
    .from("pit_price_requests")
    .select("id, material_type_id")
    .eq("pit_profile_id", pit.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!request) return null // known supplier, but nothing was asked — don't guess what this message means

  const price = extractPrice(text)
  if (!price) return null // no clear number in the reply — don't consume it, let it fall through honestly

  const { data: material } = await supabase
    .from("material_types").select("name").eq("id", request.material_type_id).maybeSingle()

  await supabase
    .from("pit_price_requests")
    .update({ status: "answered", reply_text: text, reply_price: price, replied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", request.id)

  // Same check-then-update-or-insert pattern as
  // app/api/admin/pits/[pitId]/materials/route.ts — pit_materials has no
  // unique constraint on (pit_profile_id, material_type_id), so an upsert
  // isn't safe here without one.
  const { data: existing } = await supabase
    .from("pit_materials")
    .select("id")
    .eq("pit_profile_id", pit.id)
    .eq("material_type_id", request.material_type_id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle()

  if (existing) {
    await supabase.from("pit_materials").update({ price, updated_at: new Date().toISOString() }).eq("id", existing.id)
  } else {
    await supabase.from("pit_materials").insert({
      id: crypto.randomUUID(),
      pit_profile_id: pit.id,
      material_type_id: request.material_type_id,
      price,
    })
  }

  return `รับทราบครับ บันทึกราคา${material?.name ?? ""} ที่ ${price.toLocaleString()} บาท/คิว เรียบร้อยแล้วครับ ขอบคุณครับ`
}
