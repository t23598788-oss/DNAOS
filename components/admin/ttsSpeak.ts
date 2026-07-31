// J.A.R.V.I.S. Voice Layer — text-to-speech (owner, 2026-07-30, fixed
// 2026-07-31): originally used only the browser's built-in speechSynthesis
// (Web Speech API). Real bug found live 2026-07-31: inside this app's Tauri
// WKWebView, speechSynthesis produced a completely silent no-op — no
// audio, no error, nothing (the Realtime wake signal itself worked, proven
// by the window correctly jumping to the front, but no sound ever played).
// Same general class of "silently blocked, zero prompt" restriction already
// hit once this session with node's missing microphone entitlement — rather
// than debug WKWebView's speech-synthesis internals blind, this now calls
// macOS's own `say` command directly via a new Tauri command
// (speak_native, src-tauri/src/lib.rs) when running inside the desktop app
// — a real system binary with zero webview involvement, confirmed to have
// a real Thai voice ("Kanya", verified live via `say -v '?'`). Falls back
// to browser speechSynthesis when NOT running inside Tauri (e.g. a plain
// browser tab during development), so this still works either way.
// Extracted out of components/admin/SecretaryChat.tsx (2026-07-30) so
// components/admin/VoiceStandbyWidget.tsx can reuse the exact same function
// instead of a second copy (Rule 101/103 — reuse before duplicating).
export async function speak(text: string) {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("speak_native", { text })
      return
    } catch {
      // fall through to browser speech as a last resort
    }
  }
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return
  window.speechSynthesis.cancel() // don't stack overlapping replies
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = "th-TH"
  const thaiVoice = window.speechSynthesis.getVoices().find((v) => v.lang === "th-TH")
  if (thaiVoice) utterance.voice = thaiVoice
  window.speechSynthesis.speak(utterance)
}
