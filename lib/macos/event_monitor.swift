import Cocoa

/// Event Monitor — ตรวจการเปลี่ยนแปลงของ LINE
struct EventMonitor {

    struct Snapshot {
        let isRunning: Bool
        let windowTitle: String?
        let chatName: String?
        let lastMessage: String?
        let timestamp: Date
    }

    private static var lastSnapshot: Snapshot?

    static func takeSnapshot() -> Snapshot {
        let running = Session.isRunning()
        let title = running ? WindowManager.getTitle() : nil
        let chat = running ? LineReader.currentChatName() : nil
        let last = running ? LineReader.readLastMessage()?.text : nil

        let snap = Snapshot(
            isRunning: running,
            windowTitle: title,
            chatName: chat,
            lastMessage: last,
            timestamp: Date()
        )
        lastSnapshot = snap
        return snap
    }

    static func hasChanged() -> Bool {
        let prev = lastSnapshot
        let current = takeSnapshot()

        if prev == nil { return true }
        if prev!.isRunning != current.isRunning { return true }
        if prev!.windowTitle != current.windowTitle { return true }
        if prev!.lastMessage != current.lastMessage { return true }
        return false
    }
}
