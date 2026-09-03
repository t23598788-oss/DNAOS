// DNA OS os-ui native pointer helper — real CGEvents ที่ System Events (AppleScript) ทำไม่ได้:
//   move / click / double / scroll / drag
// เรียกโดย connections/os-ui/adapter-contract.ts (os-ui adapter) เท่านั้น ผ่าน execFile
// ต้องการ Accessibility permission ของ process ที่ post event (เช่นเดียวกับ click ของ System Events)
//
// build: swiftc connections/os-ui/mouse-helper.swift -o connections/os-ui/bin/mouse-helper
// usage: mouse-helper move X Y | click X Y | double X Y | scroll DX DY | drag X1 Y1 X2 Y2
import CoreGraphics
import Foundation

func pt(_ a: String, _ b: String) -> CGPoint { CGPoint(x: Double(a) ?? 0, y: Double(b) ?? 0) }
/// CGEVENT INSTRUMENTATION (Owner, 2026-09-02) — สังเกตได้จริงแค่ไหน อ่านจาก SDK ไม่ใช่จากชื่อ:
///   CGEventCreateScrollWheelEvent2 คืน `CGEventRef __nullable` → **สร้างพลาดได้** และแทนด้วย nil
///   CGEventPost คืน `void`        → **ไม่มี** สัญญาณตอบรับใด ๆ ไม่รู้ว่า WindowServer รับ/ส่งต่อไหม
/// ดังนั้นข้อเท็จจริงที่แข็งแรงที่สุดที่ API พิสูจน์ได้มีสองอย่างเท่านั้น: สร้างสำเร็จไหม
/// และเราเรียก post() แล้วหรือยัง — ห้ามมี CGEVENT_ACCEPTED เพราะไม่มีใครตอบรับ
enum EventPostResult: String {
    case constructionFailed = "CGEVENT_CONSTRUCTION_FAILED"
    case postInvoked = "CGEVENT_POST_INVOKED"
}

/// เดิม: `e?.post(...)` — optional chaining เงียบ ๆ ถ้า e เป็น nil จะไม่มีอะไรเกิดขึ้น
/// และบรรทัด OK ข้างล่างก็ยังพิมพ์อยู่ดี = หลักฐานลวง ตอนนี้คืนผลลัพธ์ finite แทน
/// พฤติกรรมการ post ไม่เปลี่ยน: tap เดิม, event เดิม, จำนวน event เดิม
@discardableResult
func post(_ e: CGEvent?) -> EventPostResult {
    guard let e else { return .constructionFailed }
    e.post(tap: .cghidEventTap)
    return .postInvoked
}
let src = CGEventSource(stateID: .hidSystemState)
let a = CommandLine.arguments
guard a.count >= 2 else { print("ERR: no op"); exit(2) }
let op = a[1]

switch op {
case "pos":
  // อ่านตำแหน่ง cursor ปัจจุบัน — read-only ใช้ยืนยัน before/after ของ pointer_move
  let p = CGEvent(source: nil)?.location ?? .zero
  print("POS \(Int(p.x)) \(Int(p.y))")
case "move":
  let p = pt(a[2], a[3])
  post(CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
  print("OK move \(Int(p.x)),\(Int(p.y))")
case "click":
  // down → bounded inter-event settling → up (ลำดับสมจริง)
  // หลักฐาน run 1788244866695: down→up ที่ post ติดกัน 0ms ไม่เกิด DOM click (window server
  // coalesce/reorder events ที่มาเร็วเกิน) แต่ drag ที่ spread ~150ms เกิด click บน clickband เดียวกัน
  // → ใส่ settle ขั้นต่ำที่จำเป็น (ไม่ใช่ sleep ยาว) ให้ down ถูกส่งก่อน up. clickState=1 = DOM click
  let p = pt(a[2], a[3])
  post(CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
  usleep(20000)   // cursor settle ก่อน down
  let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)
  down?.setIntegerValueField(.mouseEventClickState, value: 1)
  post(down)
  usleep(40000)   // down→up settling ขั้นต่ำ (กัน coalesce; น้อยกว่านี้เสี่ยงไม่เกิด click)
  let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)
  up?.setIntegerValueField(.mouseEventClickState, value: 1)
  post(up)
  print("OK click \(Int(p.x)),\(Int(p.y))")
case "double":
  // native double-click: pair1 clickState=1, pair2 clickState=2; event ใหม่ทุกครั้ง (ไม่ reuse);
  // มี settling ระหว่างทุก event (ลำดับสมจริง) และช่วงระหว่าง 2 คลิก < 500ms (double-click threshold)
  let p = pt(a[2], a[3])
  post(CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
  usleep(20000)
  for state in [1, 2] {
    let d = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)
    d?.setIntegerValueField(.mouseEventClickState, value: Int64(state))
    post(d)
    usleep(40000)
    let u = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)
    u?.setIntegerValueField(.mouseEventClickState, value: Int64(state))
    post(u)
    usleep(40000)   // ระหว่างคลิกที่ 1 กับ 2 (รวม ~160ms << 500ms)
  }
  print("OK double \(Int(p.x)),\(Int(p.y))")
case "scroll":
  let dx = Int32(a[2]) ?? 0, dy = Int32(a[3]) ?? 0
  // event เดิมทุก parameter (units/.pixel, wheelCount 2, wheel1=dy, wheel2=dx, tap เดิม)
  // scrollWheelEvent2 = **หนึ่ง** event (wheel1/2/3 คือแกน ไม่ใช่จำนวน event) ตาม CGEvent.h
  let scrollResult = post(CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0))
  // OK ต้องอยู่บรรทัดแรกเสมอ — adapter ตรวจ stdout.startsWith("OK") การสลับลำดับ = เปลี่ยนพฤติกรรม
  // OK = legacy dispatch evidence เท่านั้น ห้ามใช้เป็นหลักฐาน CGEvent
  print("OK scroll \(dx),\(dy)")
  print("CGEVENT scroll events=1 event1=\(scrollResult.rawValue)")
case "drag":
  let p1 = pt(a[2], a[3]), p2 = pt(a[4], a[5])
  post(CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p1, mouseButton: .left))
  post(CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p1, mouseButton: .left))
  // เดินหลายสเต็ปให้ระบบรับเป็น drag จริง
  for i in 1...10 {
    let x = p1.x + (p2.x - p1.x) * Double(i) / 10.0
    let y = p1.y + (p2.y - p1.y) * Double(i) / 10.0
    post(CGEvent(mouseEventSource: src, mouseType: .leftMouseDragged, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left))
    usleep(15000)
  }
  post(CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p2, mouseButton: .left))
  print("OK drag \(Int(p1.x)),\(Int(p1.y))->\(Int(p2.x)),\(Int(p2.y))")
default:
  print("ERR unknown op \(op)"); exit(2)
}
