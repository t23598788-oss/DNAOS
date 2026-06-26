import Cocoa

/// CGEvent Keyboard — ส่งคีย์ไปยัง LINE
struct Keyboard {
    static func press(_ keyCode: CGKeyCode, flags: CGEventFlags = []) {
        let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true)
        let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
        down?.flags = flags
        up?.flags = flags
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
        usleep(50_000)
    }

    static func enter() { press(36) }
    static func escape() { press(53) }
    static func tab() { press(48) }
    static func backspace() { press(51) }
    static func up() { press(126) }
    static func down() { press(125) }
    static func left() { press(123) }
    static func right() { press(124) }

    static func cmd(_ key: String) {
        guard let code = charToKeyCode(key) else { return }
        press(code, flags: .maskCommand)
    }

    static func cmdShift(_ key: String) {
        guard let code = charToKeyCode(key) else { return }
        press(code, flags: [.maskCommand, .maskShift])
    }

    static func copy() { cmd("c") }
    static func paste() { cmd("v") }
    static func selectAll() { cmd("a") }
    static func find() { cmd("f") }

    static func typeText(_ text: String) {
        let prev = NSPasteboard.general.string(forType: .string)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        usleep(100_000)
        paste()
        usleep(200_000)
        // restore clipboard
        NSPasteboard.general.clearContents()
        if let prev = prev { NSPasteboard.general.setString(prev, forType: .string) }
    }

    private static func charToKeyCode(_ char: String) -> CGKeyCode? {
        let map: [String: CGKeyCode] = [
            "a":0,"b":11,"c":8,"d":2,"e":14,"f":3,"g":5,"h":4,"i":34,"j":38,
            "k":40,"l":37,"m":46,"n":45,"o":31,"p":35,"q":12,"r":15,"s":1,
            "t":17,"u":32,"v":9,"w":13,"x":7,"y":16,"z":6,
            "1":18,"2":19,"3":20,"4":21,"5":23,"6":22,"7":26,"8":28,"9":25,"0":29,
        ]
        return map[char.lowercased()]
    }
}
