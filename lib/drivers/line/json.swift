import Foundation

/// JSON response — ทุกคำสั่งคืนรูปแบบเดียวกัน
func json(_ ok: Bool, _ cmd: String, _ data: [String: Any] = [:], error: String? = nil) -> [String: Any] {
    var r: [String: Any] = ["success": ok, "command": cmd, "timestamp": ISO8601DateFormatter().string(from: Date())]
    for (k, v) in data { r[k] = v }
    if let e = error { r["error"] = e }
    return r
}

func noWindow(_ cmd: String) -> [String: Any] {
    json(false, cmd, error: "LINE window not found")
}

func printJSON(_ result: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: result, options: .prettyPrinted),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}
