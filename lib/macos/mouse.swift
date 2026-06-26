import Cocoa

/// CGEvent Mouse — คลิก/ลาก/เลื่อน
struct Mouse {
    static func click(x: Double, y: Double) {
        let point = CGPoint(x: x, y: y)
        let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
        let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
        usleep(100_000)
    }

    static func doubleClick(x: Double, y: Double) {
        let point = CGPoint(x: x, y: y)
        for _ in 0..<2 {
            let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
            let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
            down?.setIntegerValueField(.mouseEventClickState, value: 2)
            up?.setIntegerValueField(.mouseEventClickState, value: 2)
            down?.post(tap: .cghidEventTap)
            up?.post(tap: .cghidEventTap)
        }
        usleep(100_000)
    }

    static func rightClick(x: Double, y: Double) {
        let point = CGPoint(x: x, y: y)
        let down = CGEvent(mouseEventSource: nil, mouseType: .rightMouseDown, mouseCursorPosition: point, mouseButton: .right)
        let up = CGEvent(mouseEventSource: nil, mouseType: .rightMouseUp, mouseCursorPosition: point, mouseButton: .right)
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
        usleep(100_000)
    }

    static func scroll(dy: Int32) {
        let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)
        event?.post(tap: .cghidEventTap)
        usleep(100_000)
    }

    static func move(x: Double, y: Double) {
        let point = CGPoint(x: x, y: y)
        let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
        event?.post(tap: .cghidEventTap)
    }
}
