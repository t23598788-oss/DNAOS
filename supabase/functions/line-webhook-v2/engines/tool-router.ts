// Owner instruction 2026-07-10/11: "ให้มันเลือกใช้เครื่องมือในระบบเฮียได้เอง"
// (let the bot choose which tool to use itself) — this replaces the old
// hard-coded "always check isDebtInquiry() first" regex gate with a single
// classification step that picks WHICH read-only tool fits the message, if
// any.
//
// Critical constraint that stays in force: "อย่าให้ AI เข้ามามั่วเยอะ" / "ห้าม
// เดา" — classification never authors the reply. The actual answer text
// always comes straight from a deterministic engine function reading real DB
// rows (same as before).
//
// Real fix, 2026-07-31 (roadmap #1, capability-roadmap.json): this used to
// call Claude (callClaudeTool, claude-client.ts) to pick the tool — silently
// returning null in production the whole time (ANTHROPIC_API_KEY either
// unset, or later set but blocked on zero credit balance per capability #12
// — either way, check_debt/order_status/purchase_history routing has never
// actually fired live). A local Ollama call was considered and ruled out for
// a real, structural reason, not convenience: this file runs inside
// supabase/functions/line-webhook-v2, a Deno EDGE FUNCTION in Supabase's
// cloud — it cannot reach http://localhost:11434 (Ollama only listens on the
// owner's own Mac). That's the same verified network-topology constraint
// documented in capability #23 (Two-Brain Unification). The real fix:
// classification for these 3 specific, narrow intents doesn't need an LLM at
// all — order_status/purchase_history read the same way isDebtInquiry()
// above already does (keyword match), which is already trusted in
// production for the debt case. No AI round-trip, no dead API dependency,
// no async-queue complexity needed for a 3-way keyword classification.
import { isDebtInquiry, answerDebtInquiry } from "./relationship-qa.ts"
import { tryOrderStatus } from "./order-status.ts"
import { tryPurchaseHistory } from "./purchase-history.ts"

const ORDER_STATUS_KEYWORDS = ["งานถึงไหน", "งานถึงไหนแล้ว", "ของถึงหรือยัง", "ของมาหรือยัง", "สถานะงาน", "สถานะออเดอร์", "ส่งของหรือยัง", "รถออกหรือยัง"]
const PURCHASE_HISTORY_KEYWORDS = ["เคยซื้อ", "ประวัติการซื้อ", "ประวัติการสั่งซื้อ", "ซื้ออะไรไปบ้าง", "สั่งอะไรไปบ้าง"]

function classify(text: string): "check_debt" | "order_status" | "purchase_history" | null {
  if (isDebtInquiry(text)) return "check_debt"
  if (ORDER_STATUS_KEYWORDS.some((k) => text.includes(k))) return "order_status"
  if (PURCHASE_HISTORY_KEYWORDS.some((k) => text.includes(k))) return "purchase_history"
  return null
}

// Returns the reply text to send back, or null if no tool matched (fall
// through to the existing awaiting_info / auto-build-event flow).
export async function tryRouteToTool(supabase: any, userId: string, text: string): Promise<string | null> {
  switch (classify(text)) {
    case "check_debt":
      return await answerDebtInquiry(supabase, userId)
    case "order_status":
      return await tryOrderStatus(supabase, userId)
    case "purchase_history":
      return await tryPurchaseHistory(supabase, userId)
    default:
      return null
  }
}
