# execution/code-change/ — NOT_YET_BUILT

**หน้าที่:** แก้ไข Source Code จริง (เช่น AI agent แก้โค้ดใน repository
ที่ลงทะเบียนไว้) — จุดที่ "เสี่ยงที่สุด" ของทั้งระบบ ต้องผ่าน
`../../governance/source-validation/` และ
`../../permissions/execution-policy/` ก่อนเสมอ

**Input:** `CommandEnvelope` ที่ classify แล้วว่า intent = code_change,
มี diff/patch แนบมา

**Output:** ผลการแก้ไข → บันทึกที่ `../../audit/code-change-audit/`

**Dependency ที่อนุญาต:** `../../contracts/command/`,
`../../software/repository-registry/`,
`../../governance/source-validation/`,
`../../permissions/execution-policy/`

**สิ่งที่ห้ามแตะ:** ห้ามแก้ไฟล์นอกขอบเขต repository ที่ระบุใน command —
ห้ามข้าม `source-validation` แม้ Owner จะเป็นผู้สั่งเอง

ไม่มีไฟล์ source ในโฟลเดอร์นี้ — นี่คือความสามารถที่มีความเสี่ยงสูงสุด
ในระบบทั้งหมด ยังไม่มี implementation ใดๆ
