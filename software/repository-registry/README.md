# software/repository-registry/ — NOT_YET_BUILT

**หน้าที่:** ทะเบียน Git Repository ที่ระบบควบคุมนี้รู้จัก — เช่น
`dna-os-deadboard`, `DNA-OS-INFRASTRUCTURE` เอง, และ repo อื่นในอนาคต
เก็บแค่ metadata (ชื่อ repo, remote URL, branch หลัก, ใครเป็นเจ้าของ
Software ที่ผูกกับ repo นี้) — **ไม่เก็บ source code ของ repo อื่นไว้ที่นี่**

**Input:** ยังไม่กำหนด

**Output:** ยังไม่มี — คาดว่าจะเป็น `RepositoryRegistration` shape คล้าย
`../software-registry/software.ts`'s `SoftwareRegistration` เมื่อสร้างจริง

**Dependency ที่อนุญาต:** `../software-registry/` (repository มักผูกกับ
Software หนึ่งตัว)

**สิ่งที่ห้ามแตะ:** ห้ามเก็บ credential ของ repo ไว้ในไฟล์นี้ —
credential reference อยู่ใน `../../config/connection-settings/` เท่านั้น

ไม่มีไฟล์ source ในโฟลเดอร์นี้ — ยังไม่มี real repository registration
mechanism
