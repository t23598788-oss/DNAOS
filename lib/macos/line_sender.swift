import Cocoa
import ApplicationServices

/// LINE Sender — ส่งข้อความผ่าน Accessibility + Keyboard
struct LineSender {

    /// พิมพ์ข้อความลงช่อง input แล้วกด Enter
    static func sendMessage(_ text: String) -> Bool {
        guard Session.isRunning() else { return false }
        _ = Session.activate()
        usleep(300_000)

        // หา input field
        guard let win = Accessibility.mainWindow() else { return false }
        let fields = Accessibility.findTextFields(root: win)

        if let inputField = fields.last {
            // ใช้ Accessibility API ตั้งค่าตรง
            if Accessibility.setValue(inputField, text) {
                usleep(200_000)
                Keyboard.enter()
                return true
            }
        }

        // Fallback: ใช้ clipboard
        Keyboard.typeText(text)
        usleep(200_000)
        Keyboard.enter()
        return true
    }

    /// ค้นหาแชทแล้วเปิด
    static func openChat(_ name: String) -> Bool {
        guard Session.isRunning() else { return false }
        _ = Session.activate()
        usleep(300_000)

        // Cmd+F เปิด search
        Keyboard.find()
        usleep(500_000)

        // พิมพ์ชื่อ
        Keyboard.typeText(name)
        usleep(1_000_000)

        // Enter เปิดแชท
        Keyboard.enter()
        usleep(500_000)

        return true
    }

    /// กลับไปหน้า chat list
    static func back() {
        Keyboard.escape()
        usleep(300_000)
    }
}
