// Outbound Supplier RFQ — reply parser (owner, 2026-07-24 · WAVE 2 rewrite, 2026-10-25).
//
// WAVE 2 CHANGE (central authority consolidation): this engine no longer writes
// public.pit_materials at all. A seller's LINE reply is an OFFER with evidence —
// not a central price change. The old code updated/inserted the published price
// directly from a chat message, which made provider identity a de-facto price
// authority (no scope check, no audit, no transaction).
//
// New contract — exactly one path:
//   seller message → (this parser) → Connect bridge /api/internal/connect/material-price
//     → engines/canonical/material-price-write.ts#recordSellerOffer
//     → public.pit_price_requests (status=answered) + audit_logs(price.offer_recorded)
//   The central price (pit_materials) only changes through applyMaterialPrice(),
//   which requires owner/delegated authority (core/authority/resolve.ts).
//
// Fail-closed: bridge missing/rejecting = return null, NOTHING is written and the
// seller is never told "บันทึกราคาแล้ว". Same "if no clear signal, return null"
// discipline as payment-claim.ts / payment-instructions.ts.
import { sendConnectSellerOffer } from "../../_shared/connect-price.ts";

const PRICE_PATTERN = /(\d+(?:[.,]\d+)?)/;

export function extractPrice(text: string): number | null {
  const match = text.match(PRICE_PATTERN);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function trySupplierQuoteReply(
  supabase: any,
  lineUserId: string,
  text: string,
  sourceMessageId: string | null = null,
): Promise<string | null> {
  const { data: pit } = await supabase
    .from("pit_profiles")
    .select("id, pit_name")
    .eq("line_user_id", lineUserId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!pit) return null; // not a known seller LINE contact — customer-side chain handles it

  const { data: request } = await supabase
    .from("pit_price_requests")
    .select("id, material_type_id")
    .eq("pit_profile_id", pit.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!request) return null; // known seller, nothing was asked — never guess

  const price = extractPrice(text);
  if (!price) return null; // no clear number — do not consume the message

  const { data: material } = await supabase
    .from("material_types")
    .select("name")
    .eq("id", request.material_type_id)
    .maybeSingle();

  const offer = await sendConnectSellerOffer({
    requestId: request.id,
    price,
    sourceMessageId,
    replyText: text,
    actor: "system:line:supplier-quote-reply",
    // A redelivered LINE message must not record the same offer twice.
    idempotencyKey: sourceMessageId ? `seller_offer:${request.id}:${sourceMessageId}` : null,
  });

  // No local fallback, no direct write: the offer either lands in the central
  // writer with its audit row, or it is left for a human.
  if (!offer.ok) return null;

  const materialName = material?.name ?? "";
  if (offer.data?.already_recorded) {
    return `ข้อเสนอราคา${materialName} ${price.toLocaleString()} บาทนี้ บันทึกไว้แล้วครับ รอเจ้าหน้าที่ตรวจสอบก่อนประกาศราคาครับ`;
  }
  return `รับข้อเสนอราคา${materialName} ${price.toLocaleString()} บาทครับ — ส่งให้เจ้าหน้าที่ตรวจสอบก่อนประกาศเป็นราคากลางครับ`;
}
