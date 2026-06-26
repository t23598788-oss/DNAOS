import Foundation

let arguments = CommandLine.arguments
let command = arguments.count > 1 ? arguments[1] : "status"

var args: [String: String] = [:]
var i = 2
while i < arguments.count - 1 {
    let key = arguments[i].replacingOccurrences(of: "--", with: "")
    let value = arguments[i + 1]
    args[key] = value
    i += 2
}

let result = LineController.execute(command, args: args)

if let jsonData = try? JSONSerialization.data(withJSONObject: result, options: .prettyPrinted),
   let jsonString = String(data: jsonData, encoding: .utf8) {
    print(jsonString)
}
