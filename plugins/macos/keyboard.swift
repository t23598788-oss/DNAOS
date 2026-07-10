import Cocoa

/// Keyboard — shared keyboard control
struct KB {
    static func press(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
        let d = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)
        let u = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
        d?.flags = flags; u?.flags = flags
        d?.post(tap: .cghidEventTap); u?.post(tap: .cghidEventTap)
        usleep(50_000)
    }

    static func enter()  { press(36) }
    static func escape() { press(53) }
    static func tab()    { press(48) }

    static func cmd(_ c: String) { if let k = charCode(c) { press(k, .maskCommand) } }
    static func cmdShift(_ c: String) { if let k = charCode(c) { press(k, [.maskCommand, .maskShift]) } }

    static func paste(_ text: String) {
        let prev = NSPasteboard.general.string(forType: .string)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        usleep(100_000)
        cmd("v")
        usleep(200_000)
        NSPasteboard.general.clearContents()
        if let p = prev { NSPasteboard.general.setString(p, forType: .string) }
    }

    private static func charCode(_ c: String) -> CGKeyCode? {
        let m: [String: CGKeyCode] = [
            "a":0,"b":11,"c":8,"d":2,"e":14,"f":3,"g":5,"h":4,"i":34,"j":38,
            "k":40,"l":37,"m":46,"n":45,"o":31,"p":35,"q":12,"r":15,"s":1,
            "t":17,"u":32,"v":9,"w":13,"x":7,"y":16,"z":6
        ]
        return m[c.lowercased()]
    }
}
