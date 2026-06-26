/**
 * DNA OS — LINE Receiver (Phase 1)
 *
 * LINE → Webhook → Verify Signature → Parse Event → Save to Supabase → 200 OK
 *
 * ไม่มี AI / ไม่ตอบกลับ / ไม่สร้างเอกสาร
 * แค่รับและเก็บข้อมูลให้ครบ
 */

import { verifySignature } from "./verify.ts";
import { parseEvent } from "./parser.ts";
import { saveEvent } from "./database.ts";
import { ok, error, cors } from "./response.ts";
import type { WebhookBody } from "./types.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return cors();
  if (req.method !== "POST") return error(405, "Method not allowed");

  // 1. อ่าน body
  let rawBody: string;
  let body: WebhookBody;
  try {
    rawBody = await req.text();
    body = JSON.parse(rawBody);
  } catch {
    return error(400, "Invalid JSON");
  }

  // 2. ตรวจ signature
  const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET");
  if (channelSecret) {
    const signature = req.headers.get("x-line-signature");
    const valid = await verifySignature(rawBody, signature, channelSecret);
    if (!valid) return error(401, "Invalid signature");
  }

  // 3. Parse + Save ทุก event
  const events = body.events ?? [];
  const results: { ok: boolean; messageId?: string; dbId?: string; error?: string }[] = [];

  for (const event of events) {
    if (event.type !== "message") continue;

    const parsed = parseEvent(event);
    const saved = await saveEvent(parsed, event);

    results.push({
      ok: saved.ok,
      messageId: parsed.messageId ?? undefined,
      dbId: saved.id,
      error: saved.error,
    });

    if (saved.ok) {
      console.log(`[line-receiver] saved: ${parsed.messageType} from ${parsed.userId?.substring(0, 8)}... → ${saved.id}`);
    } else {
      console.error(`[line-receiver] failed: ${saved.error}`);
    }
  }

  // 4. ตอบ 200 OK (ไม่ reply message)
  return ok({ received: results.length, results });
});
