# control/integration-verification/

**หน้าที่:** ยืนยันว่า relationship ที่ประกาศไว้ (ผ่าน
`../registration-update/`'s ADD_RELATIONSHIP) ระหว่าง capability ที่เพิ่ง
REGISTERED กับ consumer ของมัน เป็นของจริง — อ่าน relationship edge จริง
จาก `../../software/registry-database/` และตรวจว่าไฟล์หลักฐาน test
มีอยู่จริงบน disk ไม่เชื่อคำกล่าวอ้างของผู้เรียกเลย

**Input:** `IntegrationVerificationInput` (capability_id +
`ConsumerRelationshipProof[]`), real `RegistryStore`

**Output:** `IntegrationVerificationResult` —
`INTEGRATED | NOT_INTEGRATED | UNRESOLVED` พร้อมผลตรวจต่อ proof

**Dependency ที่อนุญาต:** `../../software/registry-database/contract.ts`
(types + `findCapability`), `./types.ts`, `./host-runtime.ts`

**สิ่งที่ห้ามแตะ:** ห้ามรายงาน INTEGRATED จากคำกล่าวอ้างของผู้เรียกเอง —
ทุก proof ต้องถูกอ่านยืนยันซ้ำจาก store จริงและ filesystem จริงเท่านั้น
ห้ามเขียนหรือแก้ relationship ใด ๆ ที่นี่ (write อยู่ที่
`../registration-update/` เท่านั้น) — โฟลเดอร์นี้อ่านอย่างเดียว
