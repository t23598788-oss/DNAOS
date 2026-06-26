import Cocoa
import ApplicationServices

/// Resolver — หา UI Element อัตโนมัติ
/// ไม่ใช้ pixel position  UI เปลี่ยน → หาใหม่เอง
struct Resolver {
    private static var cache: [String: AXUIElement] = [:]
    private static var lastWin: String?

    static func get(_ name: String, in win: AXUIElement) -> AXUIElement? {
        let wt = AX.title(win) ?? ""
        if wt != lastWin { cache.removeAll(); lastWin = wt }
        if let c = cache[name] { return c }
        let el = find(name, win)
        if let el = el { cache[name] = el }
        return el
    }

    static func invalidate() { cache.removeAll(); lastWin = nil }

    private static func find(_ name: String, _ win: AXUIElement) -> AXUIElement? {
        switch name {
        case "input":
            let f = AX.find(win, role: kAXTextFieldRole) + AX.find(win, role: kAXTextAreaRole)
            return f.last
        case "messages":
            let areas = AX.find(win, role: kAXScrollAreaRole, depth: 5)
            var best: AXUIElement?; var max = 0
            for a in areas { let c = AX.texts(a, depth: 6).count; if c > max { max = c; best = a } }
            return best
        case "chatlist":
            for r in [kAXListRole, kAXOutlineRole, kAXTableRole] {
                if let el = AX.find(win, role: r, depth: 5).first { return el }
            }
            return AX.find(win, role: kAXScrollAreaRole, depth: 4).first
        case "send":
            return AX.findFirst(win) { el in
                let t = (AX.title(el) ?? "").lowercased()
                return AX.role(el) == kAXButtonRole && (t.contains("send") || t.contains("ส่ง"))
            }
        default:
            return AX.findFirst(win) { el in
                (AX.ident(el) ?? "").lowercased().contains(name) ||
                (AX.title(el) ?? "").lowercased().contains(name)
            }
        }
    }
}
