# governance/release-gate/ — NOT_YET_BUILT

**หน้าที่:** ด่านสุดท้ายก่อนปล่อยงาน — ตรวจว่า
`../source-validation/`, `../dependency-rules/`, `../permission-rules/`
ผ่านหมดแล้ว ก่อนอนุญาตให้ `../../execution/deploy/` ทำงานจริง

**Input:** ผลตรวจจาก governance subfolder อื่นทั้งหมด +
`../../execution/test/`'s Test Result

**Output:** อนุญาต/ปฏิเสธการ deploy พร้อมเหตุผล (ไม่ใช่ boolean เปล่า —
เหมือนหลักการเดียวกับ `../../contracts/command/routing-result.ts`'s
`RoutingResult`)

**Dependency ที่อนุญาต:** governance subfolder อื่นทั้งหมด,
`../../execution/test/`, `../../connections/vercel/`'s declared contract
(ทางเดียว — ดูหมายเหตุด้านล่าง)

**สิ่งที่ห้ามแตะ:** ห้ามให้ `../../execution/deploy/` ข้ามด่านนี้ไม่ว่า
กรณีใด รวมถึงคำสั่งจาก Owner เอง

ไม่มีไฟล์ source ในโฟลเดอร์นี้

## ขอบเขตเพิ่มเติมสำหรับ Vercel Checks (Owner, 2026-08-14 — boundary planned, ยังไม่สร้างจริง)

โฟลเดอร์นี้เป็นเจ้าของ **การตัดสินใจ** ว่า Vercel Check ที่ผูกกับ
`blocks: "deployment-alias"` หรือ `"deployment-promotion"` ควรได้ผลลัพธ์
`succeeded`/`failed`/`neutral` — ส่วนการเรียก
`PATCH .../check-runs/{id}` จริงไปหา Vercel ต้องผ่าน
`../../connections/vercel/`'s contract เท่านั้น **ห้ามเรียก HTTP ตรงจาก
โฟลเดอร์นี้เด็ดขาด** เดียวกับกฎ `contracts/` → `permissions/` ทางเดียวใน
root README: โฟลเดอร์นี้พึ่ง `../../connections/vercel/` ได้
`../../connections/vercel/` ห้ามพึ่งโฟลเดอร์นี้กลับ

**ล็อกไว้จนกว่าจะพิสูจน์ได้:** ไม่มี Checks-write capability ใดถูกสร้างจน
`../../connections/vercel/CHECKS_API_LIVE_TEST_PLAN.md`'s test รันจริงและ
รู้ผลจริงว่า project-scoped token พอหรือไม่ (ดู
[`../architecture-rules/VERCEL_BOUNDARY_PLAN.md`](../architecture-rules/VERCEL_BOUNDARY_PLAN.md)
Rule 4) — ถ้าคำตอบคือ "ต้องเป็น OAuth2 Integration" การ report กลับ Vercel
ต้องรอ capability ใหม่ที่ยังไม่มีวันนี้
