// MACOS_NATIVE_NOTIFICATION_DELIVERY_V1
// UNUserNotificationCenter only. `read` never prompts. `request` is Owner-enable only.

import Foundation
import UserNotifications

struct SchedulePayload: Decodable {
    let identifier: String
    let title: String
    let body: String
    let category: String
    let thread: String
    let userInfo: [String: String]
}

func emit(_ obj: [String: String]) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
       let text = String(data: data, encoding: .utf8) {
        print(text)
    }
    exit(obj["ok"] == "true" ? 0 : 1)
}

func mapStatus(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "NOT_REQUESTED"
    case .denied: return "DENIED"
    case .authorized: return "AUTHORIZED"
    case .provisional: return "PROVISIONAL"
    default: return "NOT_AVAILABLE"
    }
}

let args = CommandLine.arguments
let command = args.count > 1 ? args[1] : "read"

if Bundle.main.bundleIdentifier == nil {
    emit([
        "ok": "true",
        "state": "NOT_AVAILABLE",
        "error_code": "NO_APP_BUNDLE",
        "implementation": "UNUserNotificationCenter",
        "NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED": "false",
    ])
}

let center = UNUserNotificationCenter.current()
let semaphore = DispatchSemaphore(value: 0)

if command == "read" {
    center.getNotificationSettings { settings in
        emit([
            "ok": "true",
            "state": mapStatus(settings.authorizationStatus),
            "implementation": "UNUserNotificationCenter",
            "NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED": "false",
        ])
    }
    _ = semaphore.wait(timeout: .now() + 6)
    emit(["ok": "false", "state": "ERROR", "error_code": "TIMEOUT"])
}

if command == "request" {
    center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
        if let error {
            emit(["ok": "false", "state": "ERROR", "error_code": error.localizedDescription])
        }
        center.getNotificationSettings { settings in
            emit([
                "ok": granted ? "true" : "true",
                "state": mapStatus(settings.authorizationStatus),
                "granted": granted ? "true" : "false",
            ])
        }
    }
    _ = semaphore.wait(timeout: .now() + 8)
    emit(["ok": "false", "state": "ERROR", "error_code": "TIMEOUT"])
}

if command == "schedule" {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let payload = try? JSONDecoder().decode(SchedulePayload.self, from: input) else {
        emit(["ok": "false", "result": "DELIVERY_FAILED", "error_code": "MALFORMED_PAYLOAD"])
    }
    let content = UNMutableNotificationContent()
    content.title = payload.title
    content.body = payload.body
    content.categoryIdentifier = payload.category
    content.threadIdentifier = payload.thread
    content.userInfo = payload.userInfo
    content.sound = .none
    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.2, repeats: false)
    let request = UNNotificationRequest(identifier: payload.identifier, content: content, trigger: trigger)
    center.add(request) { error in
        if let error {
            emit(["ok": "false", "result": "DELIVERY_FAILED", "error_code": error.localizedDescription])
        }
        emit(["ok": "true", "result": "DELIVERY_ACCEPTED_BY_OS"])
    }
    _ = semaphore.wait(timeout: .now() + 8)
    emit(["ok": "false", "result": "DELIVERY_FAILED", "error_code": "TIMEOUT"])
}

emit(["ok": "false", "state": "ERROR", "error_code": "UNKNOWN_COMMAND"])
