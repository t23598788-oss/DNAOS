import Foundation

struct ChatInfo {
    let name: String
    let unread: Int
}

struct Message {
    let text: String
    let sender: String
    let timestamp: Date
}

struct DriverStatus {
    let running: Bool
    let accessibility: Bool
    let window: String
    let chat: String
}

let BUNDLE_ID = "jp.naver.line.mac"
