/**
 * POST /api/internal/connect/material-price — Connect price boundary (WAVE 2).
 *
 * เส้นเดียวที่ provider tier (Deno) ใช้อัปเดต "ข้อเสนอราคาของผู้ขาย" แทนการ
 * เขียน public.pit_materials / public.pit_price_requests ตรง ๆ
 *
 *   External Provider → Connect normalization → POST .../material-price
 *     → engines/canonical/material-price-write.ts → public.pit_price_requests + audit_logs
 *
 * Command vocabulary is CLOSED and deliberately narrow:
 *   price.offer.record — a seller's quoted price is EVIDENCE/an OFFER only.
 *                        It NEVER changes the central (published) price.
 *   (no price.write here: a central price change needs a verified actor
 *    identity + grant data that a provider boundary must not assert.)
 *
 * Auth: one secret per bridge (MATERIAL_PRICE_INTERNAL_SECRET) — same pattern
 * as CONNECT_INTERNAL_SECRET / PAYMENT_CONFIRM_INTERNAL_SECRET. Fail-closed:
 * no secret = 503, mismatch = 401, writer rejection = ok:false (no fallback,
 * no direct write anywhere else).
 *
 * Body fields are mapped explicitly — never a row shape, never an amount that
 * the caller could use to inflate a price (the price here is the SELLER's
 * quoted value in their own request, stored as the request's reply_price).
 */
import { NextResponse } from "next/server";
import { recordSellerOffer } from "@/engines/canonical/material-price-write";

interface MaterialPriceRequest {
  command?: string;
  actor?: string;
  payload?: Record<string, unknown>;
}

const COMMANDS = ["price.offer.record"] as const;
type Command = (typeof COMMANDS)[number];

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export async function POST(req: Request) {
  const secret = process.env.MATERIAL_PRICE_INTERNAL_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "MATERIAL_PRICE_INTERNAL_SECRET not configured" }, { status: 503 });
  }
  if (req.headers.get("x-material-price-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  let body: MaterialPriceRequest;
  try {
    body = (await req.json()) as MaterialPriceRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "unparseable JSON body" }, { status: 400 });
  }

  const command = str(body.command) as Command | null;
  const actor = str(body.actor);
  if (!command || !COMMANDS.includes(command)) {
    return NextResponse.json({ ok: false, error: `command ต้องเป็นหนึ่งใน ${COMMANDS.join(", ")}` }, { status: 400 });
  }
  if (!actor) return NextResponse.json({ ok: false, error: "actor is required" }, { status: 400 });

  const p = obj(body.payload) ?? {};

  try {
    switch (command) {
      case "price.offer.record": {
        const requestId = str(p.request_id);
        const price = num(p.price);
        if (!requestId || price === null) {
          return NextResponse.json({ ok: false, error: "request_id และ price ต้องระบุ" }, { status: 400 });
        }
        const result = await recordSellerOffer({
          request_id: requestId,
          price,
          source_message_id: str(p.source_message_id),
          reply_text: str(p.reply_text),
          actor,
          idempotency_key: str(p.idempotency_key),
        });
        return NextResponse.json({ ok: true, data: result });
      }
    }
  } catch (e: unknown) {
    // Writer rejections are business results, not 500s with a stack trace:
    // the Deno caller treats ok:false as "leave it for a human".
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }

  return NextResponse.json({ ok: false, error: "unsupported command" }, { status: 400 });
}
