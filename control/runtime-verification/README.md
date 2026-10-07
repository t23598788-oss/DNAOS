# control/runtime-verification/

**หน้าที่:** ยืนยันขั้นสุดท้ายก่อน COMPLETE — ตรวจว่ามีหลักฐานการ probe
runtime จริงของ capability นี้ (ไฟล์บน disk) และหลักฐานนั้นสด (mtime ≥
เวลาที่ Deploy/Install เสร็จ) ไม่ใช่หลักฐานเก่าที่ถูกนำมาใช้ซ้ำ
โฟลเดอร์นี้ไม่เรียก capability เองเพราะ `../../execution/run/` ถูก Owner
ล็อกห้าม `control/` import (ดู `../../execution/run/contract.ts`) — ผู้
เรียกที่รู้จัก capability นั้นจริงต้อง probe เองแล้วอ้างอิงไฟล์หลักฐานมา

**Input:** `RuntimeVerificationInput`

**Output:** `RuntimeVerificationResult` —
`RUNTIME_VERIFIED | RUNTIME_VERIFY_FAILED | UNRESOLVED`

**Dependency ที่อนุญาต:** `./types.ts`, `./host-runtime.ts`

**สิ่งที่ห้ามแตะ:** ห้ามรายงาน RUNTIME_VERIFIED เมื่อไฟล์หลักฐานไม่มีอยู่
จริงหรือเก่ากว่าเวลา Deploy/Install เสร็จ ห้าม import
`../../execution/run/` เด็ดขาด
