# config/environment/ — pattern documented, no loader built yet

**หน้าที่:** Environment Reference — ระบุว่า config/credential แต่ละตัว
ควรมาจาก environment variable ชื่ออะไร ไม่เก็บค่าจริง

**Pattern (proven ใน dna-os-deadboard TASK-172, reused เป็น policy ที่นี่
ไม่ใช่คิดใหม่):** ค่าหนึ่งคือชื่อ env var (`{ kind: "env_var", name: "..."
}`) ค่าจริงอ่านจาก `process.env` เฉพาะตอนที่ adapter ใน
`../../connections/` ต้องใช้เท่านั้น — rotate credential = เปลี่ยนค่าของ
env var เท่านั้น ไม่ต้องแก้ source

**Input:** ไม่มี

**Output:** ไม่มี source จริง — pattern อยู่ที่
`../../contracts/connector/connection.ts`'s `credential_ref`

**Dependency ที่อนุญาต:** ไม่มี

**สิ่งที่ห้ามแตะ:** ห้ามมี token/secret ค่าจริงอยู่ในไฟล์ใดในโฟลเดอร์นี้
เด็ดขาด

NOT_YET_BUILT: ยังไม่มี config loader จริงที่รันในระบบนี้
