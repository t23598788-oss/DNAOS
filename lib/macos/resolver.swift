import Cocoa
import ApplicationServices

/// Resolver — หา UI Element ของ LINE อัตโนมัติ
/// ไม่ใช้ pixel position ใช้ role + heuristic
/// UI เปลี่ยน → หาใหม่เอง
struct Resolver {
    private static var cache: [String: AXUIElement] = [:]
    private static var lastWindow: String?

    static func get(_ name: String, in win: AXUIElement) -> AXUIElement? {
        let wt = AX.title(win) ?? ""
        if wt != lastWindow { cache.removeAll(); lastWindow = wt }
        if let c = cache[name] { return c }
        let el = resolve(name, win)
        if let el = el { cache[name] = el }
        return el
    }

    static func invalidate() { cache.removeAll(); lastWindow = nil }

    private static func resolve(_ name: String, _ win: AXUIElement) -> AXUIElement? {
        switch name {
        case "input":
            // Input field — มักเป็น textField/textArea ตัวสุดท้าย
            let fields = AX.find(win, role: kAXTextFieldRole) + AX.find(win, role: kAXTextAreaRole)
            return fields.last

        case "messages":
            // Message area — scroll area ที่มี text มากที่สุด
            let areas = AX.find(win, role: kAXScrollAreaRole, depth: 5)
            var best: AXUIElement?; var max = 0
            for a in areas { let c = AX.texts(a, depth: 6).count; if c > max { max = c; best = a } }
            return best

        case "chatlist":
            // Chat list — list/outline/table ตัวแรก
            for role in [kAXListRole, kAXOutlineRole, kAXTableRole] {
                if let el = AX.find(win, role: role, depth: 5).first { return el }
            }
            return AX.find(win, role: kAXScrollAreaRole, depth: 4).first

        case "send":
            // Send button
            return AX.findFirst(win) { el in
                let t = (AX.title(el) ?? "").lowercased()
                let d = (AX.str(el, kAXDescriptionAttribute) ?? "").lowercased()
                return AX.role(el) == kAXButtonRole && (t.contains("send") || t.contains("ส่ง") || d.contains("send"))
            }

        default:
            // Generic: หาจาก identifier หรือ title
            return AX.findFirst(win) { el in
                (AX.ident(el) ?? "").lowercased().contains(name.lowercased()) ||
                (AX.title(el) ?? "").lowercased().contains(name.lowercased())
            }
        }
    }
}
