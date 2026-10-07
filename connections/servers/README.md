# connections/servers/ — NOT_YET_BUILT

**หน้าที่:** adapter สำหรับเชื่อมต่อ server ภายนอก (เช่น RunPod, VPS อื่น)
— เก็บ source code ของตัวเชื่อมเท่านั้น

**Input:** `CommandEnvelope` ที่ route มาจาก `../../control/command-router/`

**Output:** `EventEnvelope` กลับผ่าน `../../contracts/operational-bridge/`

**Dependency ที่อนุญาต:** `../../contracts/connector/connection.ts`,
`../../config/connection-settings/`

**สิ่งที่ห้ามแตะ:** ห้าม hardcode server credential ในไฟล์นี้

ไม่มีไฟล์ source ในโฟลเดอร์นี้
