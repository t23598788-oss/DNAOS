import Cocoa
import ApplicationServices

/// ตรวจสิทธิ์ macOS — Accessibility ต้องได้ก่อนใช้งาน
struct Permissions {
    static func checkAccessibility() -> Bool {
        AXIsProcessTrusted()
    }

    static func requestAccessibility() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeRetainedValue(): true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    static func status() -> [String: Bool] {
        ["accessibility": checkAccessibility()]
    }
}
