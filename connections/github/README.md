# connections/github/ — NOT_YET_BUILT

**หน้าที่:** adapter สำหรับเชื่อมต่อ GitHub — เก็บ source code ของตัวเชื่อม
(auth, push/pull ผ่าน GitHub API) เท่านั้น ไม่เก็บเนื้อหา repo ที่เชื่อมถึง

**Input:** `CommandEnvelope` ที่ route มาจาก
`../../control/command-router/` พร้อม intent เกี่ยวกับ GitHub

**Output:** `EventEnvelope` (เช่น "sync.completed") กลับผ่าน
`../../contracts/operational-bridge/`

**Dependency ที่อนุญาต:** `../../contracts/connector/connection.ts`,
`../../config/connection-settings/`

**สิ่งที่ห้ามแตะ:** credential ต้องอ่านจาก env var ที่ระบุใน
`credential_ref` เท่านั้น ห้าม hardcode token ในไฟล์นี้เด็ดขาด

**บริบทที่เกี่ยวข้อง (ไม่ใช่โค้ดที่ใช้งานจริงที่นี่):** dna-os-deadboard's
TASK-172 สร้าง GitHub PAT connector ไว้ก่อน boundary นี้จะถูกกำหนด —
freeze เป็น legacy/pending-migration อยู่ที่ repo นั้น ยังไม่ได้ย้ายมาที่นี่
(การย้าย source code จริงต้องรอ Owner สั่งแยกต่างหาก)

ไม่มีไฟล์ source ในโฟลเดอร์นี้
