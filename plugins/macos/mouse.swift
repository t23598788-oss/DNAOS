import Cocoa

/// Mouse — shared mouse control
struct MS {
    static func click(_ x: Double, _ y: Double) {
        let p = CGPoint(x: x, y: y)
        let d = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)
        let u = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)
        d?.post(tap: .cghidEventTap); u?.post(tap: .cghidEventTap); usleep(100_000)
    }

    static func scroll(_ dy: Int32) {
        let e = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)
        e?.post(tap: .cghidEventTap); usleep(100_000)
    }
}
