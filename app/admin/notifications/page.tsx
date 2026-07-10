"use client"

import { useState } from "react"
import { Send, Loader2, CheckCircle, XCircle } from "lucide-react"

/**
 * Real LINE push-notification sender — calls /api/admin/notifications/send,
 * which uses the same LINE Messaging API call already deployed and proven in
 * supabase/functions/line-webhook-v2/engines/response.ts. Requires an explicit
 * click on "ส่ง" (human confirmation, Rule 72) — never auto-sends.
 */
export default function NotificationsPage() {
  const [to, setTo] = useState("")
  const [message, setMessage] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const canSend = to.trim().length > 0 && message.trim().length > 0

  async function send() {
    setSending(true)
    setResult(null)
    try {
      const res = await fetch("/api/admin/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: to.trim(), message: message.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setResult({ ok: false, text: json.error ?? `HTTP ${res.status}` })
      } else {
        setResult({ ok: true, text: "ส่งข้อความสำเร็จ" })
        setMessage("")
      }
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "ส่งไม่สำเร็จ" })
    } finally {
      setSending(false)
      setConfirming(false)
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-4">
        <h1 className="text-base font-bold text-stone-800">แจ้งเตือน (LINE)</h1>
        <p className="text-[11px] text-stone-400 mt-0.5">
          ส่งข้อความ LINE จริงผ่าน LINE Messaging API — ต้องกด &quot;ส่ง&quot; เพื่อยืนยันทุกครั้ง ไม่มีการส่งอัตโนมัติ
        </p>
      </div>

      <div className="p-6 max-w-xl space-y-4">
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">LINE User ID ผู้รับ</label>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="U1234567890abcdef1234567890abcdef"
            className="w-full text-sm border border-stone-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">ข้อความ</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="w-full text-sm border border-stone-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
          />
        </div>

        {result && (
          <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 border ${result.ok ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-600"}`}>
            {result.ok ? <CheckCircle className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
            {result.text}
          </div>
        )}

        {!confirming ? (
          <button
            type="button"
            disabled={!canSend}
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" /> ส่ง
          </button>
        ) : (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <span className="text-xs text-amber-700 flex-1">ยืนยันส่งข้อความจริงไปที่ {to}?</span>
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition disabled:opacity-50"
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "ยืนยัน"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={sending}
              className="text-xs px-3 py-1.5 rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-100 transition"
            >
              ยกเลิก
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
