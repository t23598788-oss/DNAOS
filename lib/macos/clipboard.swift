import Cocoa

/// Clipboard — shared clipboard
struct CB {
    static func read() -> String? { NSPasteboard.general.string(forType: .string) }
    static func write(_ t: String) { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(t, forType: .string) }
    static func clear() { NSPasteboard.general.clearContents() }
}
