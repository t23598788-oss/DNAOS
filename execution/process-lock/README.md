# execution/process-lock/

**หน้าที่:** real cross-process named mutex — ปิด gap จริงที่พิสูจน์แล้ว:
`execution/run/executor.ts`'s `activeLockKeys` เป็น in-memory `Set`
(process เดียวเท่านั้น) และ `control/work-coordination/coordination.ts`'s
`load()`/mutate/`save()` ไม่มี lock เลย (race จริง) ใช้
`openSync(path, "wx")` (`O_CREAT|O_EXCL`) เป็นแกนหลัก — kernel รับประกันว่า
มีผู้ชนะได้สูงสุดหนึ่งรายข้าม process จริง ไม่ใช่ simulate

**Input:** `AcquireLockInput` (`lock_key`, `holder_id`, `lease_ms`)

**Output:** `AcquireLockResult` (`ACQUIRED | CONFLICT`),
`ReleaseLockResult` (`RELEASED | NOT_HOLDER | NOT_FOUND`)

**Dependency ที่อนุญาต:** `./types.ts`, `./host-runtime.ts`

**สิ่งที่ห้ามแตะ:** ห้ามเปลี่ยน `"wx"` เป็น write ธรรมดา — บรรทัดนั้นคือ
สิ่งเดียวที่ guarantee ข้าม process ทั้งหมดขึ้นอยู่กับ ห้าม unlink+recreate
เพื่อ renew lease ของตัวเอง (มี window ที่ lock หายไปชั่วขณะ) ใช้
overwrite ธรรมดาแทนหลัง verify holder จริงแล้วเท่านั้น ห้าม release lock
ที่ holder_id ไม่ตรง

**ผู้ใช้จริง (2 ราย, เข้าเกณฑ์แยก capability ตาม
CAPABILITY_FOLDER_LAW):** `control/work-coordination/` (work-item claim)
และ duplicate-fingerprint reservation (ส่วนหนึ่งของงาน Multi-Agent
Production Control รอบนี้)
