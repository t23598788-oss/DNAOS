// Owner instruction 2026-07-10/11: "ให้มันเลือกใช้เครื่องมือในระบบเฮียได้เอง"
// (let the bot choose which tool to use itself) — this replaces the old
// hard-coded "always check isDebtInquiry() first" regex gate with a single
// OpenAI function-calling call that picks WHICH read-only tool fits the
// message, if any.
//
// Critical constraint that stays in force: "อย่าให้ AI เข้ามามั่วเยอะ" / "ห้าม
// เดา" — the model's ONLY job here is picking a tool name, never authoring the
// reply. The actual answer text always comes straight from a deterministic
// engine function reading real DB rows (same as before); the model never
// sees or repeats that text.
//
// Owner instruction (2026-07-25): "เขียน AI ที่กูเอามาผูกไว้ในระบบ (ChatGPT)
// ออกไปจากระบบให้ถาวรเลย" — swapped from OpenAI function-calling to Claude
// tool-use, via the shared claude-client.ts helper.

import { isDebtInquiry, answerDebtInquiry } from "./relationship-qa.ts"
import { tryOrderStatus } from "./order-status.ts"
import { tryPurchaseHistory } from "./purchase-history.ts"
import { callClaudeTool } from "./claude-client.ts"

const TOOLS = [
  { name: "check_debt", description: "ลูกค้าถามเรื่องหนี้ค้างชำระ ยอดค้างจ่าย" },
  { name: "order_status", description: "ลูกค้าถามสถานะงาน/ออเดอร์ที่กำลังดำเนินอยู่ เช่น งานถึงไหนแล้ว ของถึงหรือยัง" },
  { name: "purchase_history", description: "ลูกค้าถามประวัติการสั่งซื้อ หรือเคยซื้อวัสดุอะไรไปบ้างในอดีต" },
]

async function classify(text: string): Promise<string | null> {
  return await callClaudeTool(
    "เลือกเครื่องมือที่เหมาะกับข้อความลูกค้า ถ้าไม่เข้าเงื่อนไขไหนเลยห้ามเรียกเครื่องมือใดๆ",
    text,
    TOOLS,
    20,
  )
}

// Returns the reply text to send back, or null if no tool matched (fall
// through to the existing awaiting_info / auto-build-event flow).
export async function tryRouteToTool(supabase: any, userId: string, text: string): Promise<string | null> {
  // Cheap deterministic fast-path stays first — no API cost, already trusted
  // in production.
  if (isDebtInquiry(text)) return await answerDebtInquiry(supabase, userId)

  const tool = await classify(text)
  switch (tool) {
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
