import Cocoa
import ApplicationServices

/// Window Manager — จัดการหน้าต่าง LINE
struct WindowManager {

    static func bringToFront() -> Bool {
        Session.activate()
    }

    static func getFrame() -> CGRect? {
        guard let win = Accessibility.mainWindow() else { return nil }
        var pos: CFTypeRef?
        var size: CFTypeRef?
        AXUIElementCopyAttributeValue(win, kAXPositionAttribute as CFString, &pos)
        AXUIElementCopyAttributeValue(win, kAXSizeAttribute as CFString, &size)

        var point = CGPoint.zero
        var sz = CGSize.zero
        if let pos = pos { AXValueGetValue(pos as! AXValue, .cgPoint, &point) }
        if let size = size { AXValueGetValue(size as! AXValue, .cgSize, &sz) }
        return CGRect(origin: point, size: sz)
    }

    static func setFrame(x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat) -> Bool {
        guard let win = Accessibility.mainWindow() else { return false }
        var point = CGPoint(x: x, y: y)
        var size = CGSize(width: w, height: h)
        let posVal = AXValueCreate(.cgPoint, &point)!
        let sizeVal = AXValueCreate(.cgSize, &size)!
        let r1 = AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, posVal)
        let r2 = AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, sizeVal)
        return r1 == .success && r2 == .success
    }

    static func minimize() -> Bool {
        guard let win = Accessibility.mainWindow() else { return false }
        return AXUIElementSetAttributeValue(win, kAXMinimizedAttribute as CFString, true as CFTypeRef) == .success
    }

    static func restore() -> Bool {
        guard let win = Accessibility.mainWindow() else { return false }
        return AXUIElementSetAttributeValue(win, kAXMinimizedAttribute as CFString, false as CFTypeRef) == .success
    }

    static func getTitle() -> String? {
        guard let win = Accessibility.mainWindow() else { return nil }
        return Accessibility.getTitle(win)
    }
}
