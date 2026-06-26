import Foundation

let args = CommandLine.arguments
let cmd = args.count > 1 ? args[1] : "status"

func p(_ k: String) -> String? {
    guard let i = args.firstIndex(of: "--\(k)"), i+1 < args.count else { return nil }
    return args[i+1]
}

let result: [String: Any] = {
    switch cmd {
    case "connect":      return LINEDriver.connect()
    case "status":       return LINEDriver.status()
    case "focus":        return LINEDriver.focus()
    case "listChats":    return LINEDriver.listChats()
    case "openChat":     return LINEDriver.openChat(p("id") ?? p("name") ?? "")
    case "currentChat":  return LINEDriver.currentChat()
    case "readMessages": return LINEDriver.readMessages(Int(p("limit") ?? "0") ?? 0)
    case "readUnread":   return LINEDriver.readUnread()
    case "send":         return LINEDriver.send(p("text") ?? "")
    case "reply":        return LINEDriver.reply(p("messageId") ?? "", p("text") ?? "")
    case "search":       return LINEDriver.search(p("keyword") ?? p("query") ?? "")
    case "back":         return LINEDriver.back()
    case "close":        return LINEDriver.close()
    default:             return json(false, cmd, error: "unknown command")
    }
}()

printJSON(result)
