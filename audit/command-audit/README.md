# audit/command-audit/ — NOT_YET_BUILT

**หน้าที่:** หลักฐานถาวรของทุก Command ที่เข้ามา — เขียนก่อนที่ผู้เรียกจะ
ได้รับแจ้งผลสำเร็จเสมอ (ตรงกับ
`../../control/command-status/lifecycle.ts`'s `evidenced` stage) รวมถึง
เป็นปลายทางของ `../../permissions/access-control/break-glass.ts`'s
`audit_event_id`

**Input:** `CommandEnvelope` + ผลจาก `../../control/command-router/`

**Output:** บันทึกถาวรต่อ command หนึ่งฉบับ

**Dependency ที่อนุญาต:** `../../contracts/command/`,
`../../control/command-status/`

**สิ่งที่ห้ามแตะ:** ห้ามลบ record — แก้ไขประวัติไม่ได้ (append-only เหมือน
หลักการเดียวกับ `permissions/access-control/membership.ts`'s revoked_at)

ไม่มีไฟล์ source ในโฟลเดอร์นี้ — ยังไม่มี command จริงที่ถึง `evidenced`
