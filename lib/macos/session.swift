import Cocoa

/// LINE Desktop Session — เปิด/ปิด/ตรวจสถานะ
struct Session {
    static let bundleId = "jp.naver.line.mac"

    static func isRunning() -> Bool {
        !NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == bundleId }.isEmpty
    }

    static func launch() -> Bool {
        if isRunning() { return activate() }
        return NSWorkspace.shared.open(URL(string: "line://")!)
    }

    static func activate() -> Bool {
        guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleId }) else { return false }
        return app.activate()
    }

    static func quit() -> Bool {
        guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleId }) else { return false }
        return app.terminate()
    }

    static func pid() -> pid_t? {
        NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleId })?.processIdentifier
    }
}
