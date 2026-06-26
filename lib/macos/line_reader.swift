import Cocoa
import ApplicationServices

/// LINE Reader — อ่านข้อความจาก LINE Desktop ผ่าน Accessibility API
struct LineReader {

    struct ChatMessage {
        let text: String
        let sender: String
        let isMe: Bool
    }

    /// อ่านข้อความทั้งหมดจากหน้าต่างปัจจุบัน
    static func readMessages() -> [ChatMessage] {
        guard let win = Accessibility.mainWindow() else { return [] }

        // หา scroll area ที่เป็น message list
        let scrollAreas = Accessibility.findElements(root: win, role: kAXScrollAreaRole, maxDepth: 6)
        guard let messageArea = scrollAreas.count > 1 ? scrollAreas[1] : scrollAreas.first else { return [] }

        let texts = Accessibility.readAllText(root: messageArea, maxDepth: 10)
        return texts.map { ChatMessage(text: $0, sender: "", isMe: false) }
    }

    /// อ่านข้อความล่าสุด
    static func readLastMessage() -> ChatMessage? {
        readMessages().last
    }

    /// อ่านชื่อแชทปัจจุบัน (จาก window title)
    static func currentChatName() -> String? {
        WindowManager.getTitle()
    }

    /// อ่านรายชื่อแชทจาก sidebar
    static func readChatList() -> [String] {
        guard let win = Accessibility.mainWindow() else { return [] }

        // sidebar มักเป็น scroll area แรก
        let scrollAreas = Accessibility.findElements(root: win, role: kAXScrollAreaRole, maxDepth: 4)
        guard let sidebar = scrollAreas.first else { return [] }

        // หา cell/row ที่เป็นรายการแชท
        let rows = Accessibility.findElements(root: sidebar, role: kAXCellRole, maxDepth: 4)
        if rows.isEmpty {
            return Accessibility.readAllText(root: sidebar, maxDepth: 6)
        }
        return rows.compactMap { Accessibility.getTitle($0) ?? Accessibility.getValue($0) }.filter { !$0.isEmpty }
    }
}
