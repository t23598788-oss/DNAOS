import Cocoa

/// Shared helpers — ทุก Driver ใช้ร่วมกัน
func appByBundle(_ id: String) -> NSRunningApplication? {
    NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == id }
}

func isAppRunning(_ id: String) -> Bool { appByBundle(id) != nil }

func activateApp(_ id: String) -> Bool { appByBundle(id)?.activate() ?? false }

func windowOf(_ bundleId: String) -> AXUIElement? {
    guard let pid = appByBundle(bundleId)?.processIdentifier else { return nil }
    return AX.windows(AX.app(pid)).first
}

func json(_ ok: Bool, _ cmd: String, _ data: [String: Any] = [:], error: String? = nil) -> [String: Any] {
    var r: [String: Any] = ["success": ok, "command": cmd, "timestamp": ISO8601DateFormatter().string(from: Date())]
    for (k, v) in data { r[k] = v }
    if let e = error { r["error"] = e }
    return r
}

func printJSON(_ result: [String: Any]) {
    if let d = try? JSONSerialization.data(withJSONObject: result, options: .prettyPrinted),
       let s = String(data: d, encoding: .utf8) { print(s) }
}
