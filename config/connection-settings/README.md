# config/connection-settings/ — NOT_YET_BUILT

**หน้าที่:** ค่าตั้งค่าที่ไม่ลับของแต่ละ connection (เช่น base URL, API
version, timeout) — คู่กับ credential reference ใน `../environment/`

**Input:** ไม่มี

**Output:** ไม่มี

**Dependency ที่อนุญาต:** `../../contracts/connector/connection.ts`

**สิ่งที่ห้ามแตะ:** ห้ามใส่ค่าลับใดๆ ในโฟลเดอร์นี้ — เฉพาะค่าที่ไม่ลับ
เท่านั้น (secret ไปที่ env var เสมอ)

ไม่มีไฟล์ source ในโฟลเดอร์นี้
