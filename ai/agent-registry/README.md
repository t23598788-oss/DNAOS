# ai/agent-registry/ — NOT_YET_BUILT

**หน้าที่:** ทะเบียน AI Agent ที่เชื่อมเข้ามาเป็น Identity ประเภท
`ai_agent` (`../../permissions/access-control/identity.ts`) — บันทึกว่า
agent ตัวไหนมีอยู่จริง แยกจาก capability negotiation (agent หนึ่งอาจ
เรียกใช้ intent/tool ได้ต่างจาก external_program ทั่วไป)

**Input:** `Identity` ที่มี `kind = "ai_agent"`

**Output:** ยังไม่มี — คาดว่าจะเป็น registration record คล้าย
`../../permissions/access-control/identity-registry.ts` แต่เพิ่ม field
เฉพาะ agent (เช่น capability list) เมื่อมี use case จริง

**Dependency ที่อนุญาต:** `../../permissions/access-control/identity.ts`

**สิ่งที่ห้ามแตะ:** ห้ามให้ agent ข้าม `../../permissions/access-control/`
ไปสั่งงานตรงๆ — agent ก็ต้องผ่าน Membership + scope-check เหมือน Identity
ประเภทอื่นทุกตัว

ไม่มีไฟล์ source ในโฟลเดอร์นี้ (ย้ายมาจากโฟลเดอร์ `agents/` เดิม)
