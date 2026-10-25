import Foundation

/// Driver Registry — DNA OS เรียกทุก Driver ผ่านตรงนี้
/// Driver.call("line", "send", ["text": "สวัสดี"])
struct DriverRegistry {
    private static var drivers: [String: Driver] = [:]

    static func register(_ driver: Driver) { drivers[driver.name] = driver }
    static func get(_ name: String) -> Driver? { drivers[name] }
    static func list() -> [String] { Array(drivers.keys) }

    static func call(_ name: String, _ command: String, _ args: [String: String] = [:]) -> [String: Any] {
        guard let driver = drivers[name] else {
            return json(false, command, error: "driver '\(name)' not found — available: \(list().joined(separator: ", "))")
        }

        switch command {
        case "connect": return driver.connect()
        case "status":  return driver.status()
        case "focus":   return driver.focus()
        case "close":   return driver.close()
        default:        return driver.execute(command: command, args: args)
        }
    }
}
