import Cocoa
import ApplicationServices

/// Reader — อ่านข้อมูลจาก LINE
struct Reader {

    static func listChats(_ win: AXUIElement) -> [String: Any] {
        guard let list = Resolver.get("chatlist", in: win) else {
            return json(false, "listChats", error: "chatlist not found")
        }
        let names = AX.texts(list, depth: 4)
        return json(true, "listChats", ["chats": names, "count": names.count])
    }

    static func currentChat(_ win: AXUIElement) -> [String: Any] {
        let t = AX.title(win) ?? ""
        return json(!t.isEmpty, "currentChat", ["chat": t])
    }

    static func readMessages(_ win: AXUIElement, limit: Int) -> [String: Any] {
        guard let area = Resolver.get("messages", in: win) else {
            return json(false, "readMessages", error: "message area not found")
        }
        var msgs = AX.texts(area, depth: 8)
        if limit > 0 && msgs.count > limit { msgs = Array(msgs.suffix(limit)) }
        return json(true, "readMessages", ["messages": msgs, "count": msgs.count, "chat": AX.title(win) ?? ""])
    }

    static func readUnread(_ win: AXUIElement) -> [String: Any] {
        return readMessages(win, limit: 0)
    }
}
