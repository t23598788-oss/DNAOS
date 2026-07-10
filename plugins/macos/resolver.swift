import Cocoa
import ApplicationServices

/// AXResolver — หา element อัตโนมัติ ใช้ได้ทุกแอป
struct AXResolver {
    private static var cache: [String: AXUIElement] = [:]
    private static var lastWin: String?

    static func get(_ name: String, in win: AXUIElement, finder: (String, AXUIElement) -> AXUIElement?) -> AXUIElement? {
        let wt = AX.title(win) ?? ""
        if wt != lastWin { cache.removeAll(); lastWin = wt }
        if let c = cache[name] { return c }
        let el = finder(name, win)
        if let el = el { cache[name] = el }
        return el
    }

    static func invalidate() { cache.removeAll(); lastWin = nil }

    /// Generic finders ใช้ได้ทุกแอป
    static func findInput(_ win: AXUIElement) -> AXUIElement? {
        (AX.find(win, role: kAXTextFieldRole) + AX.find(win, role: kAXTextAreaRole)).last
    }

    static func findScrollAreaWithMostText(_ win: AXUIElement) -> AXUIElement? {
        let areas = AX.find(win, role: kAXScrollAreaRole, depth: 5)
        var best: AXUIElement?; var max = 0
        for a in areas { let c = AX.texts(a, depth: 6).count; if c > max { max = c; best = a } }
        return best
    }

    static func findList(_ win: AXUIElement) -> AXUIElement? {
        for r in [kAXListRole, kAXOutlineRole, kAXTableRole] {
            if let el = AX.find(win, role: r, depth: 5).first { return el }
        }
        return AX.find(win, role: kAXScrollAreaRole, depth: 4).first
    }

    static func findButton(_ win: AXUIElement, title: String) -> AXUIElement? {
        AX.findFirst(win) { el in
            AX.role(el) == kAXButtonRole && ((AX.title(el) ?? "").lowercased().contains(title.lowercased()))
        }
    }
}
