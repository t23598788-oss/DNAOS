"use client"

import { useState, useRef, useEffect } from "react"

interface BoardSection {
  type: string
  title?: string
  subtitle?: string | null
  html?: string
  items?: Array<{ title?: string; subtitle?: string | null; label?: string; value?: string }>
}

interface ChatMessage {
  id: string
  role: "user" | "ai"
  text: string
  sections?: BoardSection[]
  confirmToken?: string
  confirmAction?: string
  confirmResolved?: "confirmed" | "cancelled" | "failed"
}

let seq = 0
function nextId() {
  seq += 1
  return `m${Date.now()}-${seq}`
}

export function SecretaryChat({ openingText }: { openingText?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (openingText) {
      setMessages([{ id: nextId(), role: "ai", text: openingText }])
    }
  }, [openingText])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setInput("")
    setMessages((m) => [...m, { id: nextId(), role: "user", text }])
    setSending(true)
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      setMessages((m) => [...m, {
        id: nextId(),
        role: "ai",
        text: data.text ?? "รับทราบครับ",
        sections: data.workspace?.sections,
        confirmToken: data.confirm_token,
        confirmAction: data.confirm_action,
      }])
    } catch {
      setMessages((m) => [...m, { id: nextId(), role: "ai", text: "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้งครับ" }])
    } finally {
      setSending(false)
    }
  }

  async function confirm(msg: ChatMessage) {
    if (!msg.confirmToken || !msg.confirmAction) return
    setMessages((m) => m.map((x) => x.id === msg.id ? { ...x, confirmResolved: "confirmed" } : x))
    try {
      const res = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: msg.confirmAction, preview_token: msg.confirmToken }),
      })
      const data = await res.json()
      setMessages((m) => [...m, {
        id: nextId(),
        role: "ai",
        text: data.ok ? "บันทึกเรียบร้อยครับ" : `ยืนยันไม่สำเร็จ: ${data.error ?? "ไม่ทราบสาเหตุ"}`,
      }])
    } catch {
      setMessages((m) => [...m, { id: nextId(), role: "ai", text: "ยืนยันไม่สำเร็จ ลองใหม่อีกครั้งครับ" }])
    }
  }

  function cancel(msg: ChatMessage) {
    setMessages((m) => m.map((x) => x.id === msg.id ? { ...x, confirmResolved: "cancelled" } : x))
  }

  return (
    <div className="bg-white border border-stone-200 rounded-xl flex flex-col h-[560px]">
      <div className="px-4 py-3 border-b border-stone-100">
        <div className="text-xs font-semibold text-stone-700">เลขาส่วนตัว</div>
        <div className="text-[10px] text-stone-400 mt-0.5">พิมพ์สั่งงานได้เลย เช่น "เสนอราคาให้ [ชื่อบริษัท]"</div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs whitespace-pre-line ${
              msg.role === "user"
                ? "bg-stone-800 text-white"
                : "bg-stone-100 text-stone-700"
            }`}>
              {msg.text}

              {msg.sections?.map((s, i) => (
                s.html ? (
                  <div key={i} className="mt-2 border border-stone-200 rounded-lg overflow-hidden bg-white">
                    {s.title && <div className="text-[10px] font-semibold text-stone-500 px-2 py-1 border-b border-stone-100">{s.title}</div>}
                    <div className="p-2 text-[11px]" dangerouslySetInnerHTML={{ __html: s.html }} />
                  </div>
                ) : s.items?.length ? (
                  <div key={i} className="mt-2 border border-stone-200 rounded-lg overflow-hidden bg-white divide-y divide-stone-50">
                    {s.title && <div className="text-[10px] font-semibold text-stone-500 px-2 py-1 bg-stone-50">{s.title}</div>}
                    {s.items.map((it, j) => (
                      <div key={j} className="px-2 py-1.5 text-[11px] flex justify-between gap-2">
                        <span className="text-stone-600 truncate">{it.title ?? it.label}</span>
                        <span className="text-stone-400 shrink-0">{it.subtitle ?? it.value}</span>
                      </div>
                    ))}
                  </div>
                ) : null
              ))}

              {msg.confirmToken && !msg.confirmResolved && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => confirm(msg)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 transition"
                  >
                    ยืนยัน
                  </button>
                  <button
                    onClick={() => cancel(msg)}
                    className="px-2.5 py-1 rounded-lg border border-stone-300 text-stone-500 text-[11px] hover:bg-stone-50 transition"
                  >
                    ยกเลิก
                  </button>
                </div>
              )}
              {msg.confirmResolved === "cancelled" && (
                <div className="mt-1 text-[10px] text-stone-400">ยกเลิกแล้ว ยังไม่บันทึกอะไร</div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-stone-100 p-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="พิมพ์สั่งงาน..."
          className="flex-1 text-xs border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-400"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="px-3 py-2 rounded-lg bg-stone-800 text-white text-xs font-semibold disabled:opacity-40 hover:bg-stone-700 transition"
        >
          {sending ? "..." : "ส่ง"}
        </button>
      </div>
    </div>
  )
}
