import Foundation

let args = CommandLine.arguments
let cmd = args.count > 1 ? args[1] : "status"

func param(_ key: String) -> String? {
    guard let i = args.firstIndex(of: "--\(key)"), i + 1 < args.count else { return nil }
    return args[i + 1]
}

let result: [String: Any]

switch cmd {
case "connect":     result = LINEDriver.connect()
case "status":      result = LINEDriver.status()
case "focus":       result = LINEDriver.focus()
case "listChats":   result = LINEDriver.listChats()
case "openChat":    result = LINEDriver.openChat(param("id") ?? param("name") ?? "")
case "currentChat": result = LINEDriver.currentChat()
case "readMessages":result = LINEDriver.readMessages(Int(param("limit") ?? "0") ?? 0)
case "readUnread":  result = LINEDriver.readUnread()
case "send":        result = LINEDriver.send(param("text") ?? "")
case "reply":       result = LINEDriver.reply(param("messageId") ?? "", param("text") ?? "")
case "search":      result = LINEDriver.search(param("keyword") ?? param("query") ?? "")
case "back":        result = LINEDriver.back()
case "close":       result = LINEDriver.close()
default:            result = ["success": false, "command": cmd, "error": "unknown command"]
}

if let data = try? JSONSerialization.data(withJSONObject: result, options: .prettyPrinted),
   let str = String(data: data, encoding: .utf8) {
    print(str)
}
