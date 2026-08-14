# ai/model-router/ — NOT_YET_BUILT

**หน้าที่:** เลือกและส่งงานให้โมเดล AI ที่เหมาะสมตาม intent ที่ผ่านการ
classify มาจาก `../../control/command-router/` แล้ว — เฉพาะกรณี intent
นั้นเกี่ยวกับ AI model โดยตรง (ไม่ใช่ทุก command)

**Input:** `CommandEnvelope` ที่ classify แล้วว่า intent เกี่ยวกับ AI

**Output:** เรียก adapter ใน `../../connections/ai-providers/`

**Dependency ที่อนุญาต:** `../model-registry/`, `../../contracts/command/`,
`../../connections/ai-providers/`

**สิ่งที่ห้ามแตะ:** ห้ามให้ตัวนี้ตัดสินใจ authorize เอง —
authorize เกิดที่ `../../permissions/` เสมอ ก่อนมาถึงชั้นนี้

ไม่มีไฟล์ source ในโฟลเดอร์นี้
