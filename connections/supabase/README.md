# connections/supabase/ — NOT_YET_BUILT

**หน้าที่:** adapter สำหรับ Supabase **ในฐานะปลายทางซอฟต์แวร์เท่านั้น**
(เช่น เชื่อมไปยัง Supabase project ของ software ตัวหนึ่งเพื่อสั่งงาน/ตรวจ
สถานะ) — **นี่ไม่ใช่ Supabase ของ dna-os-deadboard** และห้ามใช้เป็นทาง
เข้าไปอ่าน/เขียนข้อมูลธุรกิจใดๆ ทั้งสิ้น (ดู root README.md's boundary
rule — ห้าม direct database dependency ระหว่าง Operational กับ
Infrastructure)

**Input:** `CommandEnvelope` ที่ route มาจาก `../../control/command-router/`

**Output:** `EventEnvelope` กลับผ่าน `../../contracts/operational-bridge/`

**Dependency ที่อนุญาต:** `../../contracts/connector/connection.ts`,
`../../config/connection-settings/`

**สิ่งที่ห้ามแตะ:** ห้าม query ตารางธุรกิจใดๆ ผ่าน adapter นี้ — ขอบเขต
คือ "Supabase project หนึ่งในฐานะ Software ที่ถูกควบคุม" เท่านั้น ไม่ใช่
ฐานข้อมูลธุรกิจ

ไม่มีไฟล์ source ในโฟลเดอร์นี้
