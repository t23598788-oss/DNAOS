"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { speak } from "@/components/admin/ttsSpeak"

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

// Central Intent Dispatcher (owner, 2026-07-30): "ห้ามให้ไฟล์ UI แต่ละหน้าไป
// นั่งดักจับคำสั่งเสียงกันเองแบบสะเปะสะปะ ข้อความทั้งหมดจากเฮีย ต้องวิ่งเข้า
// Central Brain Pipeline ที่เดียว" — ALL wake/back/window-control/external-
// open/screen-vision pattern matching used to live here, duplicating the
// exact same patterns in cognitive/pipeline.ts's classifyClientCommand().
// That was the bug: two independent regex sets that could (and did) drift
// out of sync. This component is now a pure "thin executor": every message
// goes to /api/chat first; the server's ClientDirective fields
// (wake/back/window_action/external_url/screen_vision/navigate_url/
// pulse_node) tell this component which client-only side effect to perform.
// Nothing here decides intent anymore — it only carries out what the
// central brain already decided.
async function performWindowAction(action: "minimize" | "maximize" | "close") {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    const win = getCurrentWindow()
    if (action === "minimize") await win.minimize()
    else if (action === "maximize") {
      const isMax = await win.isMaximized()
      if (isMax) await win.unmaximize()
      else await win.maximize()
    } else if (action === "close") await win.close()
  } catch {
    // honest failure — not running in a real Tauri window, or API unavailable
  }
}

async function performOpenApp(appName: string): Promise<string> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return "เปิดแอปได้เฉพาะตอนรันเป็นแอปเดสก์ท็อปเท่านั้นครับ"
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    return await invoke<string>("open_app", { appName })
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

async function performScreenVision(goal?: string): Promise<string> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return "อ่านหน้าจอได้เฉพาะตอนรันเป็นแอปเดสก์ท็อปเท่านั้นครับ"
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("capture_screen")
    const res = await fetch("/api/admin/screen-vision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal }),
    })
    const data = await res.json()
    return data.text ?? data.error ?? "อ่านหน้าจอไม่สำเร็จครับ"
  } catch (err) {
    return `ถ่ายภาพหน้าจอไม่สำเร็จครับ (${err instanceof Error ? err.message : String(err)}) — เช็คว่าให้สิทธิ์ Screen Recording กับแอปนี้แล้วหรือยัง (System Settings → Privacy & Security → Screen Recording)`
  }
}

// Chain Action / "line.copilot" (owner, 2026-07-31, explicit go-ahead after
// discussing scope): "อนุญาตทำแบบเจาะจง เราใช้งานภายในระบบเราเพื่อที่เราจะ
// ได้ข้อมูลมาประมวลผลที่แม่นยำที่สุด" — chains three real, already-verified
// capabilities: open_app (launch LINE), Screen Vision (read-only OCR/
// translate), then feeds the OCR'd text back through the NORMAL /api/chat
// pipeline as an ordinary message — so any quote/document-drafting reuses
// the real cognitive/reasoning engine instead of a second parallel one.
// Read-only through the whole chain: never clicks/types inside LINE, and
// any real write (document.create) still requires the owner's own confirm
// click via the existing confirm_token/confirm_action flow — this function
// only gets as far as showing that confirm prompt, never past it.
async function performLineCopilot(): Promise<{ text: string; workspace?: { sections: BoardSection[] }; confirmToken?: string; confirmAction?: string } | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return { text: "อ่านแชท LINE ให้ได้เฉพาะตอนรันเป็นแอปเดสก์ท็อปเท่านั้นครับ" }
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const openResult = await invoke<string>("open_app", { appName: "LINE" })
    if (/ไม่พบแอปพลิเคชัน/.test(openResult)) return { text: openResult }
    await new Promise((r) => setTimeout(r, 1800)) // real launch/render delay, not a guess — LINE needs a moment to come to front
    await invoke("capture_screen")
    const visionRes = await fetch("/api/admin/screen-vision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "หาชื่อผู้ติดต่อที่กำลังคุยด้วย และสิ่งที่เขาขอราคาหรือขอสั่งซื้อจากข้อความล่าสุดในแชทนี้ ตอบสั้นๆ เฉพาะชื่อคนและสิ่งที่ขอเท่านั้น" }),
    })
    const visionData = await visionRes.json()
    const ocrText: string | undefined = visionData.text
    if (!ocrText) return { text: visionData.error ?? "อ่านแชท LINE ไม่ได้ผลลัพธ์ครับ" }

    // Feed the OCR'd text back through the SAME real pipeline as if typed —
    // this is what lets material.quote/document.create actually fire on it.
    const chatRes = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: ocrText }),
    })
    const chatData = await chatRes.json()
    return {
      text: `อ่านแชทได้ว่า: "${ocrText}"\n\n${chatData.text ?? "รับทราบครับ"}`,
      workspace: chatData.workspace,
      confirmToken: chatData.confirm_token,
      confirmAction: chatData.confirm_action,
    }
  } catch (err) {
    return { text: `เปิดอ่านแชท LINE ไม่สำเร็จครับ (${err instanceof Error ? err.message : String(err)})` }
  }
}

export function SecretaryChat({ openingText }: { openingText?: string }) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [voiceOn, setVoiceOn] = useState(false)
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

      // Back/home and window-control/external-open/screen-vision are pure
      // client-only side effects the server can't perform itself — but
      // WHICH one to run is decided entirely by the central dispatcher
      // (cognitive/pipeline.ts's classifyClientCommand()), never by this
      // component re-matching the raw text.
      if (data.back) {
        setMessages((m) => [...m, { id: nextId(), role: "ai", text: data.text ?? "ย้อนกลับให้แล้วครับ" }])
        router.back()
        return
      }
      if (data.window_action) {
        await performWindowAction(data.window_action)
        setMessages((m) => [...m, { id: nextId(), role: "ai", text: data.text ?? "รับทราบครับ" }])
        return
      }
      if (data.external_url) {
        window.open(data.external_url, "_blank")
        setMessages((m) => [...m, { id: nextId(), role: "ai", text: data.text ?? "เปิดให้แล้วครับ" }])
        return
      }
      if (data.screen_vision) {
        setMessages((m) => [...m, { id: nextId(), role: "ai", text: data.text ?? "กำลังอ่านหน้าจอให้ครับ..." }])
        const visionResult = await performScreenVision(data.screen_vision_goal)
        setMessages((m) => [...m, { id: nextId(), role: "ai", text: visionResult }])
        // Owner request 2026-07-30: "อ่านภาษาอังกฤษให้กูฟังหน่อย" — he can't
        // read English at all, so the translated screen content needs to
        // actually be spoken aloud, not just shown as text he can't read.
        if (voiceOn) speak(visionResult)
        return
      }
      if (data.open_app) {
        const openResult = await performOpenApp(data.open_app)
        setMessages((m) => [...m, { id: nextId(), role: "ai", text: openResult }])
        return
      }
      if (data.line_copilot) {
        setMessages((m) => [...m, { id: nextId(), role: "ai", text: data.text ?? "กำลังเปิด LINE และอ่านแชทให้ครับ..." }])
        const copilotResult = await performLineCopilot()
        if (copilotResult) {
          setMessages((m) => [...m, {
            id: nextId(),
            role: "ai",
            text: copilotResult.text,
            sections: copilotResult.workspace?.sections,
            confirmToken: copilotResult.confirmToken,
            confirmAction: copilotResult.confirmAction,
          }])
          if (voiceOn) speak(copilotResult.text)
        }
        return
      }

      const replyText = data.text ?? "รับทราบครับ"
      setMessages((m) => [...m, {
        id: nextId(),
        role: "ai",
        text: replyText,
        sections: data.workspace?.sections,
        confirmToken: data.confirm_token,
        confirmAction: data.confirm_action,
      }])
      if (voiceOn) speak(replyText)
      // Real "open screen by command" (owner, 2026-07-30): "เฮียต้องสั่งให้
      // เปิดอะไรก็ได้หน้าจอ สลับหน้าจอก็ต้องสลับหน้าจอ" — cognitive/board's
      // composeBoard() resolves which real admin page this turn's result is
      // actually about; a small delay lets the reply render first so it
      // isn't lost mid-navigation.
      if (typeof data.navigate_url === "string") {
        setTimeout(() => router.push(data.navigate_url), 600)
      }
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
    <div className="bg-white border border-stone-200 rounded-xl flex flex-col h-full">
      <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-stone-700">เลขาส่วนตัว</div>
          <div className="text-[10px] text-stone-400 mt-0.5">พิมพ์สั่งงานได้เลย เช่น "เสนอราคาให้ [ชื่อบริษัท]"</div>
        </div>
        <button
          onClick={() => {
            const next = !voiceOn
            setVoiceOn(next)
            if (!next && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel()
          }}
          title={voiceOn ? "ปิดเสียงพูด" : "เปิดให้พูดคำตอบ"}
          className={`text-[10px] px-2 py-1 rounded-lg border transition shrink-0 ${
            voiceOn ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-stone-200 text-stone-400 hover:bg-stone-50"
          }`}
        >
          {voiceOn ? "🔊 เสียง: เปิด" : "🔇 เสียง: ปิด"}
        </button>
      </div>

      <div className="thin-scrollbar flex-1 overflow-y-auto px-4 py-3 space-y-3">
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
