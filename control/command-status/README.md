# control/command-status/

**หน้าที่:** ติดตามสถานะของแต่ละ Command ตลอด lifecycle ของมัน (received
→ ... → responded/rejected/failed) — ดู `lifecycle.ts`

**Input:** `CommandEnvelope` + ผลจากแต่ละขั้นที่ `../command-router/`
ประมวลผล

**Output:** `CommandLifecycleState` — สถานะปัจจุบัน + ประวัติของ command
หนึ่งฉบับ

**Dependency ที่อนุญาต:** ไม่มี (รับแค่ id/state เป็น string/enum)

**สิ่งที่ห้ามแตะ:** ห้ามข้ามลำดับ `LEGAL_TRANSITIONS` — โดยเฉพาะห้าม
`executing` → `responded` ตรงๆ ต้องผ่าน `evidenced` ก่อนเสมอ

**Real content:** `lifecycle.ts` — type/state-machine เท่านั้น
NOT_YET_BUILT: ยังไม่มี executor จริงที่ผลิต state เหล่านี้
