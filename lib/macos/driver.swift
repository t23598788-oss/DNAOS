import Cocoa
import ApplicationServices

/// LINE Driver — Native macOS Driver สำหรับ DNA OS
/// API ชุดเดียว ไม่ผูกกับ pixel position
/// ใช้ AXUIElement + Resolver เป็นหลัก
struct LINEDriver {
    static let bundle = "jp.naver.line.mac"

    // ── connect ──
    static func connect() -> [String: Any] {
        if !AXIsProcessTrusted() {
            let opts = [kAXTrustedCheckOptionPrompt.takeRetainedValue(): true] as CFDictionary
            AXIsProcessTrustedWithOptions(opts)
            return json(false, "connect", error: "Accessibility not granted — open System Settings")
        }
        if !isRunning() { NSWorkspace.shared.open(URL(string: "line://")!); sleep(2) }
        _ = activate()
        return json(true, "connect", ["running": isRunning()])
    }

    // ── status ──
    static func status() -> [String: Any] {
        json(true, "status", [
            "running": isRunning(),
            "accessibility": AXIsProcessTrusted(),
            "window": windowTitle(),
            "chat": windowTitle()
        ])
    }

    // ── focus ──
    static func focus() -> [String: Any] {
        json(activate(), "focus")
    }

    // ── listChats ──
    static func listChats() -> [String: Any] {
        guard let win = window() else { return noWindow("listChats") }
        guard let list = Resolver.get("chatlist", in: win) else { return json(false, "listChats", error: "chatlist not found") }
        let names = AX.texts(list, depth: 4)
        return json(true, "listChats", ["chats": names, "count": names.count])
    }

    // ── openChat ──
    static func openChat(_ id: String) -> [String: Any] {
        guard isRunning() else { return json(false, "openChat", error: "LINE not running") }
        _ = activate(); usleep(300_000)
        key(3, .maskCommand) // Cmd+F
        usleep(500_000)
        paste(id)
        usleep(1_000_000)
        key(36) // Enter
        usleep(500_000)
        Resolver.invalidate()
        return json(true, "openChat", ["chat": id])
    }

    // ── currentChat ──
    static func currentChat() -> [String: Any] {
        let t = windowTitle()
        return json(!t.isEmpty, "currentChat", ["chat": t])
    }

    // ── readMessages ──
    static func readMessages(_ limit: Int) -> [String: Any] {
        guard let win = window() else { return noWindow("readMessages") }
        guard let area = Resolver.get("messages", in: win) else { return json(false, "readMessages", error: "message area not found") }
        var msgs = AX.texts(area, depth: 8)
        if limit > 0 && msgs.count > limit { msgs = Array(msgs.suffix(limit)) }
        return json(true, "readMessages", ["messages": msgs, "count": msgs.count, "chat": windowTitle()])
    }

    // ── readUnread ──
    static func readUnread() -> [String: Any] {
        // อ่านทั้งหมดแล้วส่งคืน — Phase ถัดไปจะแยก read/unread จริง
        return readMessages(0)
    }

    // ── send ──
    static func send(_ text: String) -> [String: Any] {
        guard let win = window() else { return noWindow("send") }
        _ = activate(); usleep(200_000)

        // ลองใส่ผ่าน AX setValue ก่อน
        if let input = Resolver.get("input", in: win), AX.set(input, kAXValueAttribute, text as CFTypeRef) {
            usleep(200_000)
            key(36) // Enter
            return json(true, "send", ["text": text, "method": "accessibility"])
        }

        // Fallback: paste
        paste(text)
        usleep(200_000)
        key(36)
        return json(true, "send", ["text": text, "method": "clipboard"])
    }

    // ── reply ──
    static func reply(_ messageId: String, _ text: String) -> [String: Any] {
        // Phase 1: reply = send (ยังไม่ quote specific message)
        return send(text)
    }

    // ── search ──
    static func search(_ keyword: String) -> [String: Any] {
        guard isRunning() else { return json(false, "search", error: "LINE not running") }
        _ = activate(); usleep(300_000)
        key(3, .maskCommand) // Cmd+F
        usleep(500_000)
        paste(keyword)
        return json(true, "search", ["keyword": keyword])
    }

    // ── back ──
    static func back() -> [String: Any] {
        key(53) // Escape
        usleep(300_000)
        Resolver.invalidate()
        return json(true, "back")
    }

    // ── close ──
    static func close() -> [String: Any] {
        guard let app = runningApp() else { return json(false, "close", error: "not running") }
        let ok = app.terminate()
        return json(ok, "close")
    }

    // ══════════════════════════
    // Private
    // ══════════════════════════

    private static func isRunning() -> Bool { runningApp() != nil }

    private static func runningApp() -> NSRunningApplication? {
        NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == bundle }
    }

    private static func activate() -> Bool { runningApp()?.activate() ?? false }

    private static func window() -> AXUIElement? {
        guard let pid = runningApp()?.processIdentifier else { return nil }
        return AX.windows(AX.app(pid)).first
    }

    private static func windowTitle() -> String {
        guard let win = window() else { return "" }
        return AX.title(win) ?? ""
    }

    private static func key(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
        let d = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)
        let u = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
        d?.flags = flags; u?.flags = flags
        d?.post(tap: .cghidEventTap); u?.post(tap: .cghidEventTap)
        usleep(50_000)
    }

    private static func paste(_ text: String) {
        let prev = NSPasteboard.general.string(forType: .string)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        usleep(100_000)
        key(9, .maskCommand) // Cmd+V
        usleep(200_000)
        NSPasteboard.general.clearContents()
        if let p = prev { NSPasteboard.general.setString(p, forType: .string) }
    }

    private static func noWindow(_ cmd: String) -> [String: Any] {
        json(false, cmd, error: "LINE window not found")
    }

    private static func json(_ ok: Bool, _ cmd: String, _ data: [String: Any] = [:], error: String? = nil) -> [String: Any] {
        var r: [String: Any] = ["success": ok, "command": cmd, "timestamp": ISO8601DateFormatter().string(from: Date())]
        for (k, v) in data { r[k] = v }
        if let e = error { r["error"] = e }
        return r
    }
}
