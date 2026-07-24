const CONFLICT_PATTERNS = [
  /ไม่ใช่บริษัท/, /ไม่ใช่ของบริษัท/, /ไม่รู้จักบริษัท/, /ไม่เคยกู้/, /ไม่เคยสั่ง/, /ยอดไม่ถูก/, /ยอดผิด/, /ไม่ใช่ยอด/, /สงสัย/, /ขอคุยกับคน/, /คุยกับเจ้าหน้าที่/, /เจ้าหน้าที่/, /บอท/, /มั่ว/, /หลอกลวง/, /โกง/,
]

export function isHumanTakeoverMessage(text: string): boolean {
  return CONFLICT_PATTERNS.some((pattern) => pattern.test(text.trim()))
}

export async function getConversationMode(supabase: any, lineUserId: string): Promise<"ai" | "human_takeover"> {
  const { data } = await supabase.from("line_conversation_controls").select("mode").eq("line_user_id", lineUserId).maybeSingle()
  return data?.mode === "human_takeover" ? "human_takeover" : "ai"
}

export async function activateHumanTakeover(
  supabase: any,
  lineUserId: string,
  lineEventId: string | null,
  text: string,
): Promise<void> {
  await supabase.from("line_conversation_controls").upsert({
    line_user_id: lineUserId,
    mode: "human_takeover",
    reason: text.slice(0, 500),
    detected_line_event_id: lineEventId,
    updated_at: new Date().toISOString(),
    resolved_at: null,
  }, { onConflict: "line_user_id" })
}
