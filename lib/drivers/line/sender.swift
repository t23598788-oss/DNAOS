import Cocoa
import ApplicationServices

/// Sender — ส่งข้อความ / เปิดแชท / ค้นหา
struct Sender {

    static func send(_ win: AXUIElement, text: String) -> [String: Any] {
        if let input = Resolver.get("input", in: win), AX.set(input, kAXValueAttribute, text as CFTypeRef) {
            usleep(200_000)
            key(36) // Enter
            return json(true, "send", ["text": text, "method": "accessibility"])
        }
        paste(text)
        usleep(200_000)
        key(36)
        return json(true, "send", ["text": text, "method": "clipboard"])
    }

    static func reply(_ text: String) -> [String: Any] {
        // Phase 1: reply = send ในแชทปัจจุบัน
        guard let win = LINEDriver.window() else { return noWindow("reply") }
        return send(win, text: text)
    }

    static func openChat(_ name: String) -> [String: Any] {
        key(3, .maskCommand) // Cmd+F
        usleep(500_000)
        paste(name)
        usleep(1_000_000)
        key(36) // Enter
        usleep(500_000)
        Resolver.invalidate()
        return json(true, "openChat", ["chat": name])
    }

    static func search(_ keyword: String) -> [String: Any] {
        key(3, .maskCommand) // Cmd+F
        usleep(500_000)
        paste(keyword)
        return json(true, "search", ["keyword": keyword])
    }

    static func back() -> [String: Any] {
        key(53) // Escape
        usleep(300_000)
        Resolver.invalidate()
        return json(true, "back")
    }

    // ── Keyboard helpers ──

    static func key(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
        let d = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)
        let u = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
        d?.flags = flags; u?.flags = flags
        d?.post(tap: .cghidEventTap); u?.post(tap: .cghidEventTap)
        usleep(50_000)
    }

    static func paste(_ text: String) {
        let prev = NSPasteboard.general.string(forType: .string)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        usleep(100_000)
        key(9, .maskCommand) // Cmd+V
        usleep(200_000)
        NSPasteboard.general.clearContents()
        if let p = prev { NSPasteboard.general.setString(p, forType: .string) }
    }
}
