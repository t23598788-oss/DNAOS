# execution/run/ — NOT_YET_BUILT

**หน้าที่:** สั่งรัน Software จริง (execute) หลังผ่าน
`../../permissions/execution-policy/` แล้ว

**Input:** `CommandEnvelope` ที่ classify แล้วว่า intent = run

**Output:** ผลการรัน → บันทึกที่ `../../audit/command-audit/`

**Dependency ที่อนุญาต:** `../../contracts/command/`,
`../../permissions/execution-policy/`, `../../connections/`

**สิ่งที่ห้ามแตะ:** ห้ามรันอะไรที่ยังไม่ผ่าน
`../../governance/release-gate/`

ไม่มีไฟล์ source ในโฟลเดอร์นี้
