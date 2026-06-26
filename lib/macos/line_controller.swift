import Foundation
import Cocoa

/// DNA OS — LINE Desktop Controller
/// Command-line tool ที่ Node.js เรียกได้
/// ทุกคำสั่งคืน JSON ผ่าน stdout

struct LineController {

    static func execute(_ command: String, args: [String: String]) -> [String: Any] {
        switch command {

        // ── Session ──
        case "status":
            return [
                "ok": true,
                "running": Session.isRunning(),
                "permissions": Permissions.status(),
                "window": WindowManager.getTitle() ?? "",
                "chat": LineReader.currentChatName() ?? ""
            ]

        case "launch":
            let ok = Session.launch()
            if ok { usleep(1_000_000) }
            return ["ok": ok, "action": "launch"]

        case "activate", "focus":
            return ["ok": Session.activate(), "action": "focus"]

        case "quit":
            return ["ok": Session.quit(), "action": "quit"]

        // ── Window ──
        case "window.frame":
            if let f = WindowManager.getFrame() {
                return ["ok": true, "x": f.origin.x, "y": f.origin.y, "w": f.size.width, "h": f.size.height]
            }
            return ["ok": false, "error": "no window"]

        case "window.resize":
            let x = Double(args["x"] ?? "0") ?? 0
            let y = Double(args["y"] ?? "0") ?? 0
            let w = Double(args["w"] ?? "400") ?? 400
            let h = Double(args["h"] ?? "700") ?? 700
            return ["ok": WindowManager.setFrame(x: CGFloat(x), y: CGFloat(y), w: CGFloat(w), h: CGFloat(h))]

        case "window.minimize":
            return ["ok": WindowManager.minimize()]

        case "window.restore":
            return ["ok": WindowManager.restore()]

        // ── Read ──
        case "read", "read.messages":
            let msgs = LineReader.readMessages()
            return [
                "ok": true,
                "chat": LineReader.currentChatName() ?? "",
                "count": msgs.count,
                "messages": msgs.map { ["text": $0.text, "sender": $0.sender] }
            ]

        case "read.last":
            if let msg = LineReader.readLastMessage() {
                return ["ok": true, "text": msg.text, "sender": msg.sender, "chat": LineReader.currentChatName() ?? ""]
            }
            return ["ok": false, "error": "no messages"]

        case "read.chatlist":
            let chats = LineReader.readChatList()
            return ["ok": true, "count": chats.count, "chats": chats]

        // ── Send ──
        case "send":
            guard let text = args["text"], !text.isEmpty else {
                return ["ok": false, "error": "missing text"]
            }
            return ["ok": LineSender.sendMessage(text), "action": "send"]

        case "open_chat":
            guard let name = args["name"], !name.isEmpty else {
                return ["ok": false, "error": "missing name"]
            }
            return ["ok": LineSender.openChat(name), "action": "open_chat", "name": name]

        case "back":
            LineSender.back()
            return ["ok": true, "action": "back"]

        // ── Search ──
        case "search":
            guard let query = args["query"], !query.isEmpty else {
                return ["ok": false, "error": "missing query"]
            }
            Keyboard.find()
            usleep(500_000)
            Keyboard.typeText(query)
            return ["ok": true, "action": "search", "query": query]

        // ── Keyboard ──
        case "key.enter": Keyboard.enter(); return ["ok": true]
        case "key.escape": Keyboard.escape(); return ["ok": true]
        case "key.tab": Keyboard.tab(); return ["ok": true]
        case "key.copy": Keyboard.copy(); return ["ok": true]
        case "key.paste": Keyboard.paste(); return ["ok": true]

        // ── Clipboard ──
        case "clipboard.read":
            return ["ok": true, "text": Clipboard.read() ?? ""]
        case "clipboard.write":
            Clipboard.write(args["text"] ?? "")
            return ["ok": true]

        // ── Monitor ──
        case "snapshot":
            let snap = EventMonitor.takeSnapshot()
            return [
                "ok": true,
                "running": snap.isRunning,
                "window": snap.windowTitle ?? "",
                "chat": snap.chatName ?? "",
                "lastMessage": snap.lastMessage ?? "",
                "timestamp": ISO8601DateFormatter().string(from: snap.timestamp)
            ]

        // ── Permissions ──
        case "permissions":
            if !Permissions.checkAccessibility() {
                _ = Permissions.requestAccessibility()
                return ["ok": false, "error": "Accessibility not granted", "reason": "System Settings > Privacy > Accessibility"]
            }
            return ["ok": true, "accessibility": true]

        default:
            return ["ok": false, "error": "unknown command: \(command)"]
        }
    }
}

// Entry point อยู่ใน main.swift
