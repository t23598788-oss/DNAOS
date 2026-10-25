// Connect money-OUT transport (LINE financial-edge removal · D3 deferred work
// landed, owner 2026-09-24) — the provider tier's only path to create an
// expense / partner-payable row or move a payable's status.
//
// รู้จักแค่3 คำสั่งปิด (expense.record · payable.request · payable.transition)
// และไม่รู้จัก: คอลัมน์ตาราง · การ insert/update business table ตรง · เงิน
// คิดเอง · fallback — missing env/secret, non-2xx หรือ writer ปฏิเสธ ทั้งหมด
// คืน { ok: false } ให้ caller จัดการเอง (log + ไปต่อตาม flow เดิม ไม่มี
// การเขียนตรงสำรอง) — fail-closed แบบเดียวกับ connect-event/payment/inbound
//
// env two-sided (ขาดฝั่งใด = fail closed):
//   Deno: DNA_OS_APP_URL + EXPENSE_INTERNAL_SECRET (supabase secrets)
//   Next: EXPENSE_INTERNAL_SECRET (.env.local.example มีเอกสาร)

export type ConnectExpenseCommand = "expense.record" | "payable.request" | "payable.transition"

export interface ConnectExpenseResult<T = Record<string, unknown>> {
  ok: boolean
  error?: string
  data?: T
}

export async function sendConnectExpenseCommand<T = Record<string, unknown>>(
  command: ConnectExpenseCommand,
  payload: Record<string, unknown>,
  actor: string,
): Promise<ConnectExpenseResult<T>> {
  const appUrl = Deno.env.get("DNA_OS_APP_URL")
  const secret = Deno.env.get("EXPENSE_INTERNAL_SECRET")
  if (!appUrl || !secret) {
    return { ok: false, error: "EXPENSE_CONNECT_TRANSPORT_NOT_CONFIGURED" }
  }

  try {
    const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/internal/connect/expense`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-expense-internal-secret": secret },
      body: JSON.stringify({ command, actor, payload }),
      signal: AbortSignal.timeout(8000),
    })
    const body = (await res.json().catch(() => ({}))) as ConnectExpenseResult<T>
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `EXPENSE_CONNECT_TRANSPORT_HTTP_${res.status}` }
    }
    return { ok: true, data: body.data }
  } catch (err) {
    return { ok: false, error: `EXPENSE_CONNECT_TRANSPORT_FAILED:${err instanceof Error ? err.message : String(err)}` }
  }
}
