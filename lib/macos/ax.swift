import Cocoa
import ApplicationServices

/// AX — thin wrapper สำหรับ Accessibility API
/// ไม่รู้จัก LINE ไม่รู้จักแอปไหน ทำแค่อ่าน/หา/ตั้งค่า AXUIElement
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
    static func children(_ el: AXUIElement) -> [AXUIElement] { (attr(el, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }

    static func set(_ el: AXUIElement, _ name: String, _ val: CFTypeRef) -> Bool {
        AXUIElementSetAttributeValue(el, name as CFString, val) == .success
    }

    static func press(_ el: AXUIElement) -> Bool {
        AXUIElementPerformAction(el, kAXPressAction as CFString) == .success
    }

    /// Recursive search — หา element ตาม role
    static func find(_ root: AXUIElement, role target: String, depth: Int = 8) -> [AXUIElement] {
        var out: [AXUIElement] = []
        dig(root, target, 0, depth, &out)
        return out
    }

    /// Recursive search — หา element ตาม predicate
    static func findFirst(_ root: AXUIElement, depth: Int = 8, _ match: (AXUIElement) -> Bool) -> AXUIElement? {
        if match(root) { return root }
        if depth <= 0 { return nil }
        for c in children(root) {
            if let found = findFirst(c, depth: depth - 1, match) { return found }
        }
        return nil
    }

    /// อ่าน static text ทั้งหมด
    static func texts(_ root: AXUIElement, depth: Int = 8) -> [String] {
        find(root, role: kAXStaticTextRole, depth: depth).compactMap { value($0) ?? title($0) }.filter { !$0.isEmpty }
    }

    private static func dig(_ el: AXUIElement, _ target: String, _ d: Int, _ max: Int, _ out: inout [AXUIElement]) {
        if d > max { return }
        if role(el) == target { out.append(el) }
        for c in children(el) { dig(c, target, d+1, max, &out) }
    }
}
