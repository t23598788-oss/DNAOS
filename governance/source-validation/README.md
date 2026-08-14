# governance/source-validation/ — NOT_YET_BUILT (rules written, no checker built)

ตรวจความถูกต้องของ Source Code — split มาจาก `governance/RULES.md` เดิม
+ กฎการจัดไฟล์ใหม่ (Owner, 2026-08-14)

## G-VAL-001 — ห้าม fabricate capability หรือ status

สิ่งที่ยังไม่ถูกสร้างและพิสูจน์จริงต้องระบุ `NOT_YET_BUILT` ชัดเจน ทั้งใน
code comment และในสถานะใดๆ ที่ระบบรายงานเกี่ยวกับตัวเอง ห้าม placeholder
ใดแสดงผลราวกับเป็น capability ที่ทำงานได้จริง

## G-VAL-002 — ห้ามสร้างข้อมูลธุรกิจจำลองเพื่อเติมโครง

ห้ามใส่ mock/fake business data (ชื่อบริษัทสมมติ, เลขบัญชีสมมติ ฯลฯ) แม้
เพื่อทำให้โครง "ดูสมบูรณ์" — โฟลเดอร์ที่ยังไม่มีเนื้อหาจริงให้เป็น README
เปล่าที่มี NOT_YET_BUILT ชัดเจนแทน

## G-VAL-003 — ห้าม migration/schema ของ Business Data ใน repo นี้

ไม่มี migration ใดใน repo นี้ที่แตะ business data — ถ้ามีวันหนึ่ง คือสัญญาณ
ว่าออกแบบผิดขอบเขต ไม่ใช่ feature ที่ควรมี

## G-VAL-004 — Governance Gate ของ Capability Folder Law

`REJECT` capability ใหม่ที่ไม่มีโฟลเดอร์ของตัวเอง, `REJECT` source file
ใหม่นอกขอบเขต capability, `BLOCK + REVIEW` เมื่อพบ capability ซ้ำ,
`REJECT` การเข้าถึง implementation ข้าม capability folder ตรงๆ, `BLOCK`
การลบ capability ที่ยังมี dependency ค้าง — ข้อความเต็มอยู่ที่
[`../architecture-rules/CAPABILITY_FOLDER_LAW.md`](../architecture-rules/CAPABILITY_FOLDER_LAW.md)
ข้อ 10

**สถานะ:** ยังไม่มี mechanical checker ที่ตรวจ 4 ข้อนี้อัตโนมัติ — ตรวจ
ด้วยการ review เท่านั้นวันนี้ (เหมือนที่ dna-os-deadboard เองก็ยังไม่มี
Guard ครอบคลุมกฎลักษณะนี้ทุกข้อ)
