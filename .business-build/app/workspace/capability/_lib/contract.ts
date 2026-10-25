// CAPABILITY MATCH — ค่าคงที่ของ contract (ไม่มี "use client" โดยเจตนา)
// จุดที่แก้จากการทดสอบจริง (dev server + HTTP): ค่าคงที่ที่ประกาศในโมดูล "use client"
// เมื่อ import จาก Server Component จะกลายเป็น client-reference (Function ไม่ใช่ค่า)
// จึงห้ามใช้เปรียบเทียบใน RSC — ค่าคงที่ต้องอยู่ไฟล์ plain module เท่านั้น
export const CAPABILITY_MATERIALS = "materials";
