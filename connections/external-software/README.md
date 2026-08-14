# connections/external-software/ — NOT_YET_BUILT

**หน้าที่:** adapter สำหรับซอฟต์แวร์ภายนอกอื่นที่ไม่เข้าพวก
github/vercel/supabase/ai-providers/servers โดยเฉพาะ (เช่น ERP ในอนาคต)
— เก็บ source code ของตัวเชื่อมเท่านั้น

**Input:** `CommandEnvelope` ที่ route มาจาก `../../control/command-router/`

**Output:** `EventEnvelope` กลับผ่าน `../../contracts/operational-bridge/`

**Dependency ที่อนุญาต:** `../../contracts/connector/connection.ts`,
`../../config/connection-settings/`

**สิ่งที่ห้ามแตะ:** ห้าม hardcode credential ของซอฟต์แวร์ภายนอกในไฟล์นี้

ไม่มีไฟล์ source ในโฟลเดอร์นี้ — ยังไม่มีซอฟต์แวร์ภายนอกประเภทนี้เชื่อม
เข้ามาจริง
