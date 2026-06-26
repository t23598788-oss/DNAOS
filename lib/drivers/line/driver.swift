import Cocoa
import ApplicationServices

/// LINE Driver — DNA OS เรียกผ่าน API ชุดนี้ตัวเดียว
struct LINEDriver {

    static func connect() -> [String: Any] {
        if !AXIsProcessTrusted() {
            let o = [kAXTrustedCheckOptionPrompt.takeRetainedValue(): true] as CFDictionary
            AXIsProcessTrustedWithOptions(o)
            return json(false, "connect", error: "Accessibility not granted")
        }
        if !isRunning() { NSWorkspace.shared.open(URL(string: "line://")!); sleep(2) }
        _ = activate()
        return json(true, "connect", ["running": isRunning()])
    }

    static func status() -> [String: Any] {
        json(true, "status", [
            "running": isRunning(),
            "accessibility": AXIsProcessTrusted(),
            "window": winTitle(),
            "chat": winTitle()
        ])
    }

    static func focus() -> [String: Any] {
        json(activate(), "focus")
    }

    static func listChats() -> [String: Any] {
        guard let w = window() else { return noWindow("listChats") }
        return Reader.listChats(w)
    }

    static func openChat(_ id: String) -> [String: Any] {
        guard isRunning() else { return json(false, "openChat", error: "not running") }
        _ = activate(); usleep(300_000)
        return Sender.openChat(id)
    }

    static func currentChat() -> [String: Any] {
        guard let w = window() else { return noWindow("currentChat") }
        return Reader.currentChat(w)
    }

    static func readMessages(_ limit: Int) -> [String: Any] {
        guard let w = window() else { return noWindow("readMessages") }
        return Reader.readMessages(w, limit: limit)
    }

    static func readUnread() -> [String: Any] {
        guard let w = window() else { return noWindow("readUnread") }
        return Reader.readUnread(w)
    }

    static func send(_ text: String) -> [String: Any] {
        guard let w = window() else { return noWindow("send") }
        _ = activate(); usleep(200_000)
        return Sender.send(w, text: text)
    }

    static func reply(_ messageId: String, _ text: String) -> [String: Any] {
        guard isRunning() else { return json(false, "reply", error: "not running") }
        _ = activate(); usleep(200_000)
        return Sender.reply(text)
    }

    static func search(_ keyword: String) -> [String: Any] {
        guard isRunning() else { return json(false, "search", error: "not running") }
        _ = activate(); usleep(300_000)
        return Sender.search(keyword)
    }

    static func back() -> [String: Any] {
        return Sender.back()
    }

    static func close() -> [String: Any] {
        guard let a = runningApp() else { return json(false, "close", error: "not running") }
        return json(a.terminate(), "close")
    }

    // ── Internal ──

    static func window() -> AXUIElement? {
        guard let pid = runningApp()?.processIdentifier else { return nil }
        return AX.windows(AX.app(pid)).first
    }

    private static func isRunning() -> Bool { runningApp() != nil }
    private static func runningApp() -> NSRunningApplication? {
        NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == BUNDLE_ID }
    }
    private static func activate() -> Bool { runningApp()?.activate() ?? false }
    private static func winTitle() -> String { window().flatMap { AX.title($0) } ?? "" }
}

// CLI entry point อยู่ใน main.swift
