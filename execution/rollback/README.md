# execution/rollback/ — NOT_YET_BUILT

**หน้าที่:** ย้อนกลับ deployment ที่ทำไปแล้ว ไปยัง commit/state ก่อนหน้า
ที่มีหลักฐานจริงว่าเคยผ่าน `../deploy/` มาแล้ว

**Input:** `CommandEnvelope` ที่ classify แล้วว่า intent = rollback,
อ้างอิง deployment_audit record ที่มีอยู่จริง

**Output:** Rollback Result → บันทึกที่ `../../audit/deployment-audit/`

**Dependency ที่อนุญาต:** `../../contracts/command/`,
`../../audit/deployment-audit/`, `../deploy/`

**สิ่งที่ห้ามแตะ:** ห้าม rollback ไปยัง state ที่ไม่มีหลักฐานใน
`../../audit/deployment-audit/` — ห้ามเดา state ก่อนหน้า

ไม่มีไฟล์ source ในโฟลเดอร์นี้
