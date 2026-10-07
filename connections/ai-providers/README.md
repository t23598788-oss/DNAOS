# connections/ai-providers/ — NOT_YET_BUILT

**หน้าที่:** adapter สำหรับผู้ให้บริการ AI แต่ละราย (เช่น Anthropic,
OpenAI, ผู้ให้บริการอื่น) — เก็บ source code ของตัวเชื่อมเท่านั้น

**Input:** `CommandEnvelope` ที่ route ผ่าน `../../ai/model-router/`

**Output:** `EventEnvelope` กลับผ่าน `../../contracts/operational-bridge/`

**Dependency ที่อนุญาต:** `../../contracts/connector/connection.ts`,
`../../ai/model-registry/`, `../../config/connection-settings/`

**สิ่งที่ห้ามแตะ:** ห้าม hardcode API key ของผู้ให้บริการใดในไฟล์นี้

ไม่มีไฟล์ source ในโฟลเดอร์นี้
