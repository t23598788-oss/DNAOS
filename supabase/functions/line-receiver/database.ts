/**
 * Save to Supabase — line_events table
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";
import type { ParsedEvent } from "./types.ts";

export function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

export async function saveEvent(
  parsed: ParsedEvent,
  rawJson: unknown
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("line_events")
    .insert({
      line_user_id: parsed.userId,
      line_message_id: parsed.messageId,
      raw_text: parsed.messageText,
      raw_type: parsed.messageType,
      reply_token: parsed.replyToken,
      group_id: parsed.groupId,
      event_timestamp: new Date(parsed.timestamp).toISOString(),
      raw_json: rawJson,
      status: "new",
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data.id };
}
