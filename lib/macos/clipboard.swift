import Cocoa

/// Clipboard — อ่าน/เขียน
struct Clipboard {
    static func read() -> String? {
        NSPasteboard.general.string(forType: .string)
    }

    static func write(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    static func clear() {
        NSPasteboard.general.clearContents()
    }
}
