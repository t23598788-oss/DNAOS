import Cocoa
import ApplicationServices

/// Selector Resolver — หา UI Element อัตโนมัติ
/// ถ้า LINE อัปเดต UI ระบบหาใหม่เอง ไม่ใช้ pixel position
struct Selector {

    /// Cache resolved elements (invalidate เมื่อ window เปลี่ยน)
    private static var cache: [String: AXUIElement] = [:]
    private static var cacheWindowTitle: String?

    static func resolve(_ name: String) -> AXUIElement? {
        guard let win = Accessibility.mainWindow() else { return nil }

        // Invalidate cache ถ้า window เปลี่ยน
        let currentTitle = Accessibility.getTitle(win) ?? ""
        if currentTitle != cacheWindowTitle {
            cache.removeAll()
            cacheWindowTitle = currentTitle
        }

        // Return cached
        if let cached = cache[name] { return cached }

        // Resolve
        let element: AXUIElement?
        switch name {
        case "chatList":     element = Inspector.findChatList(win)
        case "messageArea":  element = Inspector.findMessageArea(win)
        case "inputField":   element = Inspector.findInputField(win)
        case "sendButton":   element = Inspector.findSendButton(win)
        default:             element = findByHeuristic(name, in: win)
        }

        if let el = element { cache[name] = el }
        return element
    }

    /// ลบ cache ทั้งหมด (เรียกเมื่อ LINE อัปเดต)
    static func invalidate() {
        cache.removeAll()
        cacheWindowTitle = nil
    }

    /// หาจาก title / identifier / role
    private static func findByHeuristic(_ name: String, in root: AXUIElement) -> AXUIElement? {
        let lower = name.lowercased()

        // หาจาก identifier
        let allElements = flatScan(root, maxDepth: 6)
        for el in allElements {
            if let id = Accessibility.getStringAttribute(el, kAXIdentifierAttribute)?.lowercased(), id.contains(lower) {
                return el
            }
        }

        // หาจาก title
        for el in allElements {
            if let title = Accessibility.getTitle(el)?.lowercased(), title.contains(lower) {
                return el
            }
        }

        return nil
    }

    private static func flatScan(_ root: AXUIElement, maxDepth: Int) -> [AXUIElement] {
        var result: [AXUIElement] = []
        flatScanRecursive(root, depth: 0, maxDepth: maxDepth, result: &result)
        return result
    }

    private static func flatScanRecursive(_ element: AXUIElement, depth: Int, maxDepth: Int, result: inout [AXUIElement]) {
        if depth > maxDepth { return }
        result.append(element)
        for child in Accessibility.getChildren(element) {
            flatScanRecursive(child, depth: depth + 1, maxDepth: maxDepth, result: &result)
        }
    }
}
