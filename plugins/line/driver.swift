import Cocoa
import ApplicationServices

/// LINE Driver — conform to Driver protocol
/// ใช้ shared AX/KB/MS/CB จาก plugins/macos/
struct LINEDriver: Driver {
    let name = "line"
    let bundleId = "jp.naver.line.mac"

    func connect() -> [String: Any] {
        if !AXIsProcessTrusted() {
            AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeRetainedValue(): true] as CFDictionary)
            return json(false, "connect", error: "Accessibility not granted")
        }
        if !isAppRunning(bundleId) { NSWorkspace.shared.open(URL(string: "line://")!); sleep(2) }
        _ = activateApp(bundleId)
        return json(true, "connect", ["running": isAppRunning(bundleId)])
    }

    func status() -> [String: Any] {
        json(true, "status", [
            "running": isAppRunning(bundleId),
            "accessibility": AXIsProcessTrusted(),
            "window": win().flatMap { AX.title($0) } ?? "",
            "chat": win().flatMap { AX.title($0) } ?? ""
        ])
    }

    func focus() -> [String: Any] { json(activateApp(bundleId), "focus") }

    func close() -> [String: Any] {
        guard let a = appByBundle(bundleId) else { return json(false, "close", error: "not running") }
        return json(a.terminate(), "close")
    }

    func execute(command: String, args: [String: String]) -> [String: Any] {
        switch command {
        case "listChats":    return listChats()
        case "openChat":     return openChat(args["id"] ?? args["name"] ?? "")
        case "currentChat":  return currentChat()
        case "readMessages": return readMessages(Int(args["limit"] ?? "0") ?? 0)
        case "readUnread":   return readMessages(0)
        case "send":         return send(args["text"] ?? "")
        case "reply":        return send(args["text"] ?? "")
        case "search":       return search(args["keyword"] ?? args["query"] ?? "")
        case "back":         return back()
        default:             return json(false, command, error: "unknown")
        }
    }

    // ── LINE-specific ──

    private func win() -> AXUIElement? { windowOf(bundleId) }

    private func resolve(_ name: String) -> AXUIElement? {
        guard let w = win() else { return nil }
        return AXResolver.get(name, in: w) { n, w in
            switch n {
            case "input":    return AXResolver.findInput(w)
            case "messages": return AXResolver.findScrollAreaWithMostText(w)
            case "chatlist": return AXResolver.findList(w)
            case "send":     return AXResolver.findButton(w, title: "send")
            default:         return nil
            }
        }
    }

    private func listChats() -> [String: Any] {
        guard let el = resolve("chatlist") else { return json(false, "listChats", error: "chatlist not found") }
        let chats = AX.texts(el, depth: 4)
        return json(true, "listChats", ["chats": chats, "count": chats.count])
    }

    private func openChat(_ id: String) -> [String: Any] {
        guard isAppRunning(bundleId) else { return json(false, "openChat", error: "not running") }
        _ = activateApp(bundleId); usleep(300_000)
        KB.cmd("f"); usleep(500_000)
        KB.paste(id); usleep(1_000_000)
        KB.enter(); usleep(500_000)
        AXResolver.invalidate()
        return json(true, "openChat", ["chat": id])
    }

    private func currentChat() -> [String: Any] {
        let t = win().flatMap { AX.title($0) } ?? ""
        return json(!t.isEmpty, "currentChat", ["chat": t])
    }

    private func readMessages(_ limit: Int) -> [String: Any] {
        guard let area = resolve("messages") else { return json(false, "readMessages", error: "message area not found") }
        var msgs = AX.texts(area, depth: 8)
        if limit > 0 && msgs.count > limit { msgs = Array(msgs.suffix(limit)) }
        return json(true, "readMessages", ["messages": msgs, "count": msgs.count, "chat": win().flatMap { AX.title($0) } ?? ""])
    }

    private func send(_ text: String) -> [String: Any] {
        guard let w = win() else { return json(false, "send", error: "no window") }
        _ = activateApp(bundleId); usleep(200_000)
        if let input = resolve("input"), AX.set(input, kAXValueAttribute, text as CFTypeRef) {
            usleep(200_000); KB.enter()
            return json(true, "send", ["text": text, "method": "accessibility"])
        }
        KB.paste(text); usleep(200_000); KB.enter()
        return json(true, "send", ["text": text, "method": "clipboard"])
    }

    private func search(_ keyword: String) -> [String: Any] {
        guard isAppRunning(bundleId) else { return json(false, "search", error: "not running") }
        _ = activateApp(bundleId); usleep(300_000)
        KB.cmd("f"); usleep(500_000)
        KB.paste(keyword)
        return json(true, "search", ["keyword": keyword])
    }

    private func back() -> [String: Any] {
        KB.escape(); usleep(300_000)
        AXResolver.invalidate()
        return json(true, "back")
    }
}
