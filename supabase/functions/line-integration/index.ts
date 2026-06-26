/**
 * DNA OS — LINE Integration
 *
 * LINE → Webhook → Verify → Parse → AI Translate → Save Event → Reply
 *
 * Complete pipeline:
 * 1. รับ Webhook จาก LINE
 * 2. Verify Signature
 * 3. แปลงข้อความผ่าน AI Translation
 * 4. บันทึก Event + Intent + Entity ลง DB
 * 5. Reply Message กลับ LINE
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";
import { verifySignature } from "./verify.ts";
import { translate } from "./translator.ts";
import { ok, error, cors } from "./response.ts";
import type { WebhookBody, WebhookEvent } from "./types.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return cors();
  if (req.method !== "POST") return error(405, "Method not allowed");

  // ── 1. รับ Webhook ──
  let rawBody: string;
  let body: WebhookBody;
  try {
    rawBody = await req.text();
    body = JSON.parse(rawBody);
  } catch {
    return error(400, "Invalid JSON");
  }

  // ── 2. Verify Signature ──
  const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET");
  if (channelSecret) {
    const signature = req.headers.get("x-line-signature");
    const valid = await verifySignature(rawBody, signature, channelSecret);
    if (!valid) return error(401, "Invalid signature");
  }

  // ── Setup ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const lineToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");

  const results: Record<string, unknown>[] = [];

  for (const event of body.events ?? []) {
    if (event.type !== "message" || !event.message) continue;

    const userId = event.source?.userId ?? "";
    const text = event.message.text ?? event.message.address ?? `[${event.message.type}]`;
    const messageType = event.message.type;
    const replyToken = event.replyToken;

    // ── 3. AI Translation ──
    const translation = translate(text);

    // ── 4. บันทึก Event ลง DB ──
    const { data: saved, error: dbError } = await supabase
      .from("line_events")
      .insert({
        line_user_id: userId,
        line_message_id: event.message.id,
        raw_text: text,
        raw_type: messageType,
        reply_token: replyToken,
        group_id: event.source?.groupId ?? null,
        event_timestamp: new Date(event.timestamp).toISOString(),
        raw_json: event,
        status: "new",
        extracted: translation.ok ? { intent: translation.intent, entities: translation.entities } : null,
      })
      .select("id")
      .single();

    if (dbError) {
      console.error("[line-integration] DB error:", dbError.message);
      results.push({ ok: false, error: dbError.message });
      continue;
    }

    console.log(`[line-integration] ${translation.intent} from ${userId.substring(0, 8)}... → ${saved.id}`);

    // ── 5. Reply Message ──
    let replyText = "";

    if (translation.ok) {
      switch (translation.intent) {
        case "CHECK_PRICE":
        case "CREATE_ORDER":
          replyText = `รับทราบครับ — ${translation.entities.product ?? "วัสดุ"} ${translation.entities.quantity ?? ""} ${translation.entities.unit ?? "คิว"}\nระบบกำลังคำนวณราคา`;
          break;
        case "CHECK_DEBT":
          replyText = `รับทราบครับ — กำลังตรวจสอบยอดหนี้${translation.entities.customer ? " " + translation.entities.customer : ""}`;
          break;
        case "CREATE_DOCUMENT":
          replyText = `รับทราบครับ — กำลังสร้าง${translation.entities.document_type === "invoice" ? "ใบแจ้งหนี้" : "เอกสาร"}`;
          break;
        case "CHECK_DISTANCE":
          replyText = `รับทราบครับ — กำลังคำนวณระยะทาง`;
          break;
        case "FIND_PARTNER":
          replyText = `รับทราบครับ — กำลังค้นหาข้อมูลคู่ค้า`;
          break;
        default:
          replyText = `รับทราบครับ — บันทึกข้อมูลแล้ว`;
      }
    } else {
      replyText = `รับทราบครับ — บันทึกข้อความแล้ว`;
    }

    if (lineToken && replyToken) {
      try {
        const res = await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${lineToken}` },
          body: JSON.stringify({ replyToken, messages: [{ type: "text", text: replyText }] }),
        });
        if (!res.ok) console.error("[line-integration] Reply failed:", await res.text());
      } catch (e) {
        console.error("[line-integration] Reply error:", (e as Error).message);
      }
    }

    results.push({
      ok: true,
      id: saved.id,
      intent: translation.intent,
      entities: translation.entities,
      replied: !!lineToken,
    });
  }

  return ok({ received: results.length, results });
});
