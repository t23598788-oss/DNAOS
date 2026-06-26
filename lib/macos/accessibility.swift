import Cocoa
import ApplicationServices

/// AXUIElement — อ่าน UI ของ LINE Desktop
struct Accessibility {

    static func appElement() -> AXUIElement? {
        guard let pid = Session.pid() else { return nil }
        return AXUIElementCreateApplication(pid)
    }

    static func windows() -> [AXUIElement] {
        guard let app = appElement() else { return [] }
        var value: CFTypeRef?
        AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value)
        return (value as? [AXUIElement]) ?? []
    }

    static func mainWindow() -> AXUIElement? {
        windows().first
    }

    static func getAttribute(_ element: AXUIElement, _ attr: String) -> CFTypeRef? {
        var value: CFTypeRef?
        AXUIElementCopyAttributeValue(element, attr as CFString, &value)
        return value
    }

    static func getStringAttribute(_ element: AXUIElement, _ attr: String) -> String? {
        getAttribute(element, attr) as? String
    }

    static func getChildren(_ element: AXUIElement) -> [AXUIElement] {
        (getAttribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
    }

    static func getRole(_ element: AXUIElement) -> String? {
        getStringAttribute(element, kAXRoleAttribute)
    }

    static func getValue(_ element: AXUIElement) -> String? {
        getStringAttribute(element, kAXValueAttribute)
    }

    static func getTitle(_ element: AXUIElement) -> String? {
        getStringAttribute(element, kAXTitleAttribute)
    }

    /// หา element ตาม role แบบ recursive
    static func findElements(root: AXUIElement, role: String, maxDepth: Int = 6) -> [AXUIElement] {
        var results: [AXUIElement] = []
        findRecursive(element: root, role: role, depth: 0, maxDepth: maxDepth, results: &results)
        return results
    }

    private static func findRecursive(element: AXUIElement, role: String, depth: Int, maxDepth: Int, results: inout [AXUIElement]) {
        if depth > maxDepth { return }
        if getRole(element) == role { results.append(element) }
        for child in getChildren(element) {
            findRecursive(element: child, role: role, depth: depth + 1, maxDepth: maxDepth, results: &results)
        }
    }

    /// อ่านข้อความทั้งหมดจาก static text elements
    static func readAllText(root: AXUIElement, maxDepth: Int = 8) -> [String] {
        let elements = findElements(root: root, role: kAXStaticTextRole, maxDepth: maxDepth)
        return elements.compactMap { getValue($0) ?? getTitle($0) }.filter { !$0.isEmpty }
    }

    /// หา text field (input box)
    static func findTextFields(root: AXUIElement) -> [AXUIElement] {
        findElements(root: root, role: kAXTextFieldRole) + findElements(root: root, role: kAXTextAreaRole)
    }

    /// ตั้งค่า value ของ text field
    static func setValue(_ element: AXUIElement, _ value: String) -> Bool {
        AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef) == .success
    }

    /// กด action (เช่น press button)
    static func performAction(_ element: AXUIElement, _ action: String = kAXPressAction) -> Bool {
        AXUIElementPerformAction(element, action as CFString) == .success
    }
}
