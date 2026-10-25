// Open a URL in the OS's real default browser (owner, 2026-08-03): sidebar
// "RunPod" shortcut. Inside the Tauri desktop app, a plain <a target="_blank">
// only opens a second in-app webview window, not Safari/Chrome — same
// WKWebView gap already hit with speechSynthesis (see ttsSpeak.ts) — so this
// calls the open_url Tauri command (src-tauri/src/lib.rs, uses macOS's own
// `/usr/bin/open`) when running inside the desktop app, and falls back to
// window.open for a plain browser tab (e.g. during `next dev`).
export async function openExternal(url: string) {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("open_url", { url })
      return
    } catch {
      // fall through to window.open as a last resort
    }
  }
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer")
}
