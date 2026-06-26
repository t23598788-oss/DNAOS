import Foundation

// Register drivers
DriverRegistry.register(LINEDriver())

// Parse CLI
let args = CommandLine.arguments
let driverName = args.count > 1 ? args[1] : "line"
let command = args.count > 2 ? args[2] : "status"

func p(_ k: String) -> String? {
    guard let i = args.firstIndex(of: "--\(k)"), i+1 < args.count else { return nil }
    return args[i+1]
}

// สร้าง args dict จาก --key value pairs
var params: [String: String] = [:]
var i = 3
while i < args.count - 1 {
    if args[i].hasPrefix("--") {
        params[String(args[i].dropFirst(2))] = args[i+1]
        i += 2
    } else { i += 1 }
}

// Execute
let result = DriverRegistry.call(driverName, command, params)
printJSON(result)
