import Cocoa
import ApplicationServices

/// AX Tree Inspector — สแกนโครงสร้าง UI ของ LINE ทั้งหมด
struct Inspector {

    struct UINode {
        let role: String
        let title: String
        let value: String
        let identifier: String
        let depth: Int
        let childCount: Int
        let hasTextField: Bool
    }

    /// สแกน UI Tree ทั้งหมดแล้วคืนเป็น flat list
    static func scan(maxDepth: Int = 8) -> [UINode] {
        guard let win = Accessibility.mainWindow() else { return [] }
        var nodes: [UINode] = []
        scanRecursive(element: win, depth: 0, maxDepth: maxDepth, nodes: &nodes)
        return nodes
    }

    /// สแกนเป็น JSON-friendly dictionary
    static func scanAsDict(maxDepth: Int = 8) -> [[String: Any]] {
        scan(maxDepth: maxDepth).map { node in
            [
                "role": node.role,
                "title": node.title,
                "value": node.value.prefix(200),
                "identifier": node.identifier,
                "depth": node.depth,
                "children": node.childCount,
                "hasTextField": node.hasTextField
            ] as [String: Any]
        }
    }

    /// สแกนและหา key elements อัตโนมัติ
    static func findKeyElements() -> [String: Any] {
        guard let win = Accessibility.mainWindow() else {
            return ["ok": false, "error": "no window"]
        }

        let chatList = findChatList(win)
        let messageArea = findMessageArea(win)
        let inputField = findInputField(win)
        let sendButton = findSendButton(win)

        return [
            "ok": true,
            "chatList": chatList != nil,
            "messageArea": messageArea != nil,
            "inputField": inputField != nil,
            "sendButton": sendButton != nil,
            "chatListRole": chatList.flatMap { Accessibility.getRole($0) } ?? "",
            "inputFieldRole": inputField.flatMap { Accessibility.getRole($0) } ?? "",
        ]
    }

    // ── Element Finders ──

    /// หา Chat List (sidebar) — มักเป็น scroll area / list / outline ตัวแรก
    static func findChatList(_ root: AXUIElement) -> AXUIElement? {
        let lists = Accessibility.findElements(root: root, role: kAXListRole, maxDepth: 5)
        if let first = lists.first { return first }

        let outlines = Accessibility.findElements(root: root, role: kAXOutlineRole, maxDepth: 5)
        if let first = outlines.first { return first }

        let tables = Accessibility.findElements(root: root, role: kAXTableRole, maxDepth: 5)
        return tables.first
    }

    /// หา Message Area — scroll area ที่มีข้อความมากที่สุด
    static func findMessageArea(_ root: AXUIElement) -> AXUIElement? {
        let scrollAreas = Accessibility.findElements(root: root, role: kAXScrollAreaRole, maxDepth: 5)

        var best: AXUIElement?
        var maxTexts = 0

        for area in scrollAreas {
            let texts = Accessibility.readAllText(root: area, maxDepth: 6)
            if texts.count > maxTexts {
                maxTexts = texts.count
                best = area
            }
        }
        return best
    }

    /// หา Input Field — text field / text area ตัวสุดท้าย (มักอยู่ล่างสุด)
    static func findInputField(_ root: AXUIElement) -> AXUIElement? {
        let fields = Accessibility.findTextFields(root: root)
        return fields.last
    }

    /// หา Send Button
    static func findSendButton(_ root: AXUIElement) -> AXUIElement? {
        let buttons = Accessibility.findElements(root: root, role: kAXButtonRole, maxDepth: 8)
        for btn in buttons {
            let title = (Accessibility.getTitle(btn) ?? "").lowercased()
            let desc = (Accessibility.getStringAttribute(btn, kAXDescriptionAttribute) ?? "").lowercased()
            if title.contains("send") || title.contains("ส่ง") || desc.contains("send") {
                return btn
            }
        }
        return buttons.last
    }

    // ── Private ──

    private static func scanRecursive(element: AXUIElement, depth: Int, maxDepth: Int, nodes: inout [UINode]) {
        if depth > maxDepth { return }

        let role = Accessibility.getRole(element) ?? ""
        let title = Accessibility.getTitle(element) ?? ""
        let value = Accessibility.getValue(element) ?? ""
        let children = Accessibility.getChildren(element)

        var identifier = ""
        if let id = Accessibility.getStringAttribute(element, kAXIdentifierAttribute) { identifier = id }

        let hasTextField = role == kAXTextFieldRole || role == kAXTextAreaRole

        nodes.append(UINode(
            role: role,
            title: String(title.prefix(100)),
            value: String(value.prefix(200)),
            identifier: identifier,
            depth: depth,
            childCount: children.count,
            hasTextField: hasTextField
        ))

        for child in children {
            scanRecursive(element: child, depth: depth + 1, maxDepth: maxDepth, nodes: &nodes)
        }
    }
}
