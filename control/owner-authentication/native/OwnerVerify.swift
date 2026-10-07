// หน้าที่: ตัวยืนยันตัวตนเจ้าของด้วยกลไกของ macOS เอง — เล็กที่สุดเท่าที่เป็นไปได้
//
// ทำไมต้องมีไฟล์นี้: ของเดิม `macos-console-session` อ่านชื่อ user ที่ล็อกอิน GUI
// แล้วเทียบสตริง ซึ่งเป็นการเช็ค "มีตัวตนอยู่" ไม่ใช่ "ยืนยันว่าเป็นคนนั้นจริง"
// process ใดก็ตามที่รันด้วยสิทธิ์ของ tam มินต์ session ได้เอง รวมถึง Agent ทุกตัว
//
// ไฟล์นี้ไม่ทำ authentication เอง มันขอให้ macOS ทำ:
// LAPolicy.deviceOwnerAuthentication ให้ระบบเลือก Touch ID ก่อนถ้าพร้อม และ
// ถอยไปรหัสผ่านของเครื่องได้เมื่อ Touch ID ใช้ไม่ได้ — หน้าต่างเป็นของ Apple
// ทั้งหมด DNA OS และ Agent ไม่เคยเห็นรหัสผ่าน ลายนิ้วมือ หรือข้อมูลใน Secure Enclave
//
// Input: JSON challenge ทาง stdin
// Output: JSON ผลลัพธ์ทาง stdout — มีแค่ผ่าน/ไม่ผ่าน ไม่มีความลับใด ๆ
// สิ่งที่ห้ามแตะ:
// - ห้ามสร้างหน้าต่างขอรหัสผ่านเอง ต้องเป็นหน้าต่างของ macOS เท่านั้น
// - ห้ามใช้ policy แบบ biometrics-only เจ้าของต้องใช้รหัสผ่านเครื่องได้
// - ห้ามคืนข้อมูล biometric/รหัสผ่านออกไปไม่ว่ารูปแบบใด
// - ห้ามตัดสินเองว่าใครคือเจ้าของ — ผู้เรียกส่ง expected_owner มา และ DNA OS
//   เป็นผู้ตรวจ presence คู่กันอีกชั้น

import Foundation
import LocalAuthentication

struct Challenge: Decodable {
    let challenge_id: String
    let reason: String
    let expected_owner: String
    let requested_authority_class: String
    let expires_at: String
}

struct Result: Encodable {
    let challenge_id: String
    let outcome: String              // VERIFIED | DENIED | CANCELLED | UNAVAILABLE | ERROR
    let verified_at: String?
    let verification_method_class: String?   // BIOMETRIC | DEVICE_PASSCODE | UNKNOWN
    let error_code: String?
    let detail: String?
}

func emit(_ r: Result) -> Never {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    if let data = try? encoder.encode(r), let text = String(data: data, encoding: .utf8) {
        print(text)
    }
    exit(r.outcome == "VERIFIED" ? 0 : 1)
}

func nowIso() -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date())
}

// อ่าน challenge — ไม่รับพารามิเตอร์แบบ argv เพื่อไม่ให้ reason ไปโผล่ใน process list
let input = FileHandle.standardInput.readDataToEndOfFile()
guard let challenge = try? JSONDecoder().decode(Challenge.self, from: input) else {
    emit(Result(challenge_id: "", outcome: "ERROR", verified_at: nil, verification_method_class: nil,
                error_code: "MALFORMED_CHALLENGE", detail: "อ่าน challenge จาก stdin ไม่ได้"))
}

// หมดอายุแล้วต้องไม่แสดงหน้าต่างเลย — ผู้ใช้ต้องไม่ถูกถามในสิ่งที่ใช้ไม่ได้อยู่แล้ว
let isoParser = ISO8601DateFormatter()
isoParser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
let fallbackParser = ISO8601DateFormatter()
let expiry = isoParser.date(from: challenge.expires_at) ?? fallbackParser.date(from: challenge.expires_at)
if let expiry, expiry < Date() {
    emit(Result(challenge_id: challenge.challenge_id, outcome: "DENIED", verified_at: nil,
                verification_method_class: nil, error_code: "CHALLENGE_EXPIRED", detail: "challenge หมดอายุก่อนถึงขั้นยืนยัน"))
}

let context = LAContext()
context.localizedCancelTitle = "ยกเลิก"

var canEvaluateError: NSError?
let policy: LAPolicy = .deviceOwnerAuthentication
guard context.canEvaluatePolicy(policy, error: &canEvaluateError) else {
    emit(Result(challenge_id: challenge.challenge_id, outcome: "UNAVAILABLE", verified_at: nil,
                verification_method_class: nil, error_code: "POLICY_UNAVAILABLE",
                detail: canEvaluateError?.localizedDescription ?? "เครื่องนี้ประเมิน policy นี้ไม่ได้"))
}

// วิธีที่ระบบ "พร้อมใช้" ก่อนถาม — ใช้รายงานเท่านั้น ไม่ใช่การตัดสิน
let advertised: String = context.biometryType == .touchID ? "BIOMETRIC"
    : context.biometryType == .opticID ? "BIOMETRIC" : "DEVICE_PASSCODE"

let semaphore = DispatchSemaphore(value: 0)
var outcome = Result(challenge_id: challenge.challenge_id, outcome: "ERROR", verified_at: nil,
                     verification_method_class: nil, error_code: "NO_RESULT", detail: nil)

context.evaluatePolicy(policy, localizedReason: challenge.reason) { success, error in
    if success {
        outcome = Result(challenge_id: challenge.challenge_id, outcome: "VERIFIED", verified_at: nowIso(),
                         verification_method_class: advertised, error_code: nil, detail: nil)
    } else {
        let code = (error as NSError?)?.code ?? -1
        let cancelled = code == LAError.userCancel.rawValue
            || code == LAError.systemCancel.rawValue
            || code == LAError.appCancel.rawValue
        outcome = Result(challenge_id: challenge.challenge_id,
                         outcome: cancelled ? "CANCELLED" : "DENIED", verified_at: nil,
                         verification_method_class: nil,
                         error_code: "LA_\(code)",
                         detail: error?.localizedDescription)
    }
    semaphore.signal()
}

// จำกัดเวลารอ เพื่อไม่ให้หน้าต่างค้างถือ lease ไว้ไม่รู้จบ
if semaphore.wait(timeout: .now() + 120) == .timedOut {
    emit(Result(challenge_id: challenge.challenge_id, outcome: "CANCELLED", verified_at: nil,
                verification_method_class: nil, error_code: "VERIFICATION_TIMEOUT",
                detail: "ไม่มีการตอบสนองภายใน 120 วินาที"))
}
emit(outcome)
