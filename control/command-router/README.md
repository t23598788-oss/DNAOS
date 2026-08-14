# control/command-router/ — NOT_YET_BUILT

**หน้าที่:** ศูนย์กระจายคำสั่ง — จุดเดียวที่รับ `CommandEnvelope` ทุกฉบับ
(ไม่ว่ามาจาก `../owner-command/` หรือโปรแกรมภายนอก) แล้ว authenticate →
authorize → classify → route ไปยัง adapter ที่ถูกต้องใน `../../connections/`
เท่านั้น **ห้ามมี business logic หนักอยู่ที่นี่** ตามที่ Owner สั่งไว้ตั้งแต่
รอบแรก

**Input:** `CommandEnvelope` (`../../contracts/command/command-envelope.ts`)

**Output:** `RoutingResult` (`../../contracts/command/routing-result.ts`) +
อัปเดต `../command-status/lifecycle.ts`'s `CommandLifecycleState`

**Dependency ที่อนุญาต:** `../../contracts/command/`,
`../../permissions/access-control/`, `../../permissions/software-scope/`,
`../command-status/`

**สิ่งที่ห้ามแตะ:** ห้าม router รู้วิธี "คุยกับ software จริง" โดยตรง —
นั่นเป็นหน้าที่ของ adapter ใน `../../connections/` เท่านั้น

ไม่มีไฟล์ source ในโฟลเดอร์นี้ — นี่คือ "controller" เดิมที่ถูกแยกหน้าที่
ใหม่ตาม taxonomy รอบนี้ (เดิมเป็นโฟลเดอร์ `controller/` เดี่ยวๆ)
