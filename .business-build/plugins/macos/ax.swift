import Cocoa
import ApplicationServices

/// AX — shared Accessibility wrapper
/// ทุก Driver ใช้ร่วมกัน ไม่ต้องเขียนซ้ำ
struct AX {
    static func app(_ pid: pid_t) -> AXUIElement { AXUIElementCreateApplication(pid) }

    static func windows(_ app: AXUIElement) -> [AXUIElement] {
        (attr(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
    }

    static func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
        var val: CFTypeRef?; AXUIElementCopyAttributeValue(el, name as CFString, &val); return val
    }

    static func str(_ el: AXUIElement, _ name: String) -> String? { attr(el, name) as? String }
    static func role(_ el: AXUIElement) -> String? { str(el, kAXRoleAttribute) }
    static func title(_ el: AXUIElement) -> String? { str(el, kAXTitleAttribute) }
    static func value(_ el: AXUIElement) -> String? { str(el, kAXValueAttribute) }
    static func ident(_ el: AXUIElement) -> String? { str(el, kAXIdentifierAttribute) }
    static func desc(_ el: AXUIElement) -> String? { str(el, kAXDescriptionAttribute) }
    static func children(_ el: AXUIElement) -> [AXUIElement] { (attr(el, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }

    static func set(_ el: AXUIElement, _ name: String, _ val: CFTypeRef) -> Bool {
        AXUIElementSetAttributeValue(el, name as CFString, val) == .success
    }

    static func press(_ el: AXUIElement) -> Bool {
        AXUIElementPerformAction(el, kAXPressAction as CFString) == .success
    }

    static func find(_ root: AXUIElement, role target: String, depth: Int = 8) -> [AXUIElement] {
        var out: [AXUIElement] = []
        dig(root, target, 0, depth, &out)
        return out
    }

    static func findFirst(_ root: AXUIElement, depth: Int = 8, _ match: (AXUIElement) -> Bool) -> AXUIElement? {
        if match(root) { return root }
        if depth <= 0 { return nil }
        for c in children(root) { if let f = findFirst(c, depth: depth-1, match) { return f } }
        return nil
    }

    static func texts(_ root: AXUIElement, depth: Int = 8) -> [String] {
        find(root, role: kAXStaticTextRole, depth: depth).compactMap { value($0) ?? title($0) }.filter { !$0.isEmpty }
    }

    private static func dig(_ el: AXUIElement, _ t: String, _ d: Int, _ m: Int, _ o: inout [AXUIElement]) {
        if d > m { return }; if role(el) == t { o.append(el) }
        for c in children(el) { dig(c, t, d+1, m, &o) }
    }
}
