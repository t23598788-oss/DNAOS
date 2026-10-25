"use client"

import { useEffect, useState } from "react"
import { createBrowserSupabase } from "@/services/supabase/browser"
import { speak } from "@/components/admin/ttsSpeak"

// Global Background Voice Listener — UI half (owner, 2026-07-30): "ดักฟัง
// เสียงเบื้องหลังทุกหน้าจอ...พูด 'ธวัชชัย' ปุ๊บ ต้องขานรับ 'ครับเฮีย' ทันที
// ...กราฟิกคลื่นเสียง 3D เงียบรอฟัง...ไม่ต้องขึ้นตัวหนังสือตอบโต้โง่ๆ มาบัง
// หน้าจอ...สแตนด์บายยาวจนกว่าจะสั่งปิด ห้ามดับเอง" — followed by the same-day
// architecture correction: "แอปมีหน้าที่แค่หน้าต่าง UI โชว์ผลลัพธ์และคลื่น
// เสียง! ...แยก Layer ของแอปออกจาก Background Service และ Supabase". This
// component does ONLY that: it never touches a microphone or runs any
// speech recognition itself — it subscribes to real Realtime INSERT events
// on voice_wake_events (migration 20260730000003), a table written
// exclusively by ~/dna-os-ollama/voice-wake-watcher.mjs (a macOS launchd
// daemon, runs 24/7 independent of this app/window being open at all, real
// local Whisper transcription — see that script's own header comment for
// the STT engine choice reasoning). On a real event: speaks "ครับเฮีย"
// aloud (reusing the same TTS as the chat) and shows a small ambient
// waveform — no text response overlay, per the explicit instruction not to
// cover the screen with "ตัวหนังสือตอบโต้โง่ๆ". Stays visible until the
// owner clicks to close it — no auto-hide timer (unlike the earlier,
// now-deleted AssistantWakeOverlay.tsx, see KM-009 in registry/
// existence.json — this is a new, separate component, not a revival of
// that file, built on a genuinely different signal source: a real Realtime
// DB event from an independent background daemon, not client-side text
// pattern matching).
//
// Honest limitation: the waveform animation below is a stylized ambient
// "listening" loop (CSS-driven bar heights), not literally reactive to the
// owner's live voice amplitude in real time — true audio-reactive rendering
// would need the daemon to stream raw audio levels to the browser
// continuously (e.g. via a WebSocket), a materially bigger feature not
// built this round. Flagged directly rather than faking realism.
//
// Real gap, owner-reported 2026-07-30 right after first live test: "กูจะ
// อยู่หน้าจอไหนก็ช่าง...ระบบต้องเด้งหน้าจอขึ้นมาเป็นสัญญาณเหมือน Siri รอฟัง
// คำสั่งเลย" — the wake daemon already detects the word regardless of which
// app has focus (confirmed working), but this widget lives INSIDE the DNA
// OS window; if some other app (e.g. Music) is in front, the DNA OS window
// sits behind it and the widget is invisible even though it's technically
// "showing." Real fix: on a wake event, actively bring the real Tauri
// window to the front (show + unminimize + setFocus — real window-manager
// calls, added to src-tauri/capabilities/default.json), the same way Siri's
// own overlay raises itself above whatever app you're using. Also: "ครับ
// เฮีย" alone read like it didn't acknowledge waiting for a command — now
// says the fuller, Siri-style acknowledgment.
async function bringWindowToFront() {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    const win = getCurrentWindow()
    await win.show()
    await win.unminimize()
    await win.setFocus()
  } catch {
    // not running in a real Tauri window, or API unavailable — nothing to do
  }
}

export function VoiceStandbyWidget() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase
      .channel("voice-wake-events")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "voice_wake_events" }, () => {
        setVisible(true)
        bringWindowToFront()
        speak("ครับเฮีย ให้ผมช่วยอะไรครับ")
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  if (!visible) return null

  return (
    <div className="fixed bottom-6 right-6 z-[10000] pointer-events-auto">
      <div className="w-[180px] h-[72px] rounded-2xl bg-black/90 border border-violet-500/40 shadow-2xl flex items-center justify-center gap-1 px-4 relative">
        <button
          onClick={() => setVisible(false)}
          className="absolute top-1 right-1.5 text-white/50 hover:text-white text-xs"
          aria-label="ปิด"
        >
          ✕
        </button>
        <div className="flex items-end gap-1 h-8">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className="w-1.5 bg-violet-400 rounded-full voice-wave-bar"
              style={{ animationDelay: `${i * 0.08}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
