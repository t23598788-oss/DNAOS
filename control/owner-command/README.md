# control/owner-command/ — NOT_YET_BUILT

**หน้าที่:** รับคำสั่งที่มาจาก Owner โดยเฉพาะ (ต่างจากคำสั่งจากโปรแกรม
ภายนอก/AI ทั่วไปตรงที่ Owner มีสิทธิ์ระดับ `manage_infrastructure` ตาม
`../../permissions/access-control/platform-capability.ts`) — เป็นทางเข้า
พิเศษหนึ่งเส้นทาง ไม่ใช่ทางลัดข้าม authorization

**Input:** คำสั่งจาก Owner โดยตรง (ยังไม่กำหนดช่องทางจริง)

**Output:** `CommandEnvelope` (`../../contracts/command/command-envelope.ts`) ที่
มี `issued_by.kind = "human"` และผ่าน `access-control` เหมือนคำสั่งอื่น
ทุกประการ — Owner ไม่ได้ข้าม authorization เพียงเพราะเป็น Owner

**Dependency ที่อนุญาต:** `../../contracts/command/`,
`../../permissions/access-control/`

**สิ่งที่ห้ามแตะ:** ห้ามสร้าง path ที่ให้ Owner สั่งงานโดยไม่ผ่าน
`../command-router/` — จะกลายเป็นการข้าม authorization boundary ทันที

ไม่มีไฟล์ source ในโฟลเดอร์นี้
